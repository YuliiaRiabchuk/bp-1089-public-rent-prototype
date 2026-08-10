import { http, HttpResponse, delay } from 'msw'
import {
  PUBLIC_DATASETS,
  type PublicDataset,
  type PublicExtendDay,
  type PublicRentPayload,
} from '../fixtures/public-rent-link'

/**
 * MSW для публичной страницы самообслуживания (прототип).
 *
 * Пути — отдельный префикс `/api/public/*`, не внутренний API: у страницы нет
 * сессии сотрудника, и затенять реальный бэкенд она не должна.
 *
 * Вход — по номеру: код уходит на номер, сессия открывает ВСЕ аренды этого
 * номера. Ссылка ничего не открывает и не протухает, поэтому TTL ссылки в
 * моках больше нет.
 *
 * Состояние (сессии, счётчик неверных кодов, блокировка, выпущенный счёт)
 * живёт в модуле — переживает переходы внутри вкладки и обнуляется
 * перезагрузкой. Ровно то, что нужно для демонстрации сценариев.
 */

const SMS_CODE = '424242'
/** Код живёт 5 минут: вечный код в прототипе прячет целый класс ошибок. */
const CODE_TTL_MS = 5 * 60_000
const LOCK_MS = 15 * 60_000
const MAX_ATTEMPTS = 5
/** Не чаще одной отправки в минуту и не больше пяти в сутки: SMS платные. */
const RESEND_COOLDOWN_MS = 60_000
const MAX_SENDS_PER_DAY = 5
/** Через сколько «бухгалтер проводит платёж» после выпуска счёта. */
const BANK_CONFIRM_MS = 12_000
/** Сколько система собирает и отправляет счёт юрлицу. */
const INVOICE_READY_MS = 2_500

type PayMethod = 'BALANCE' | 'BANK' | 'CARD' | 'INVOICE'
type PayStatus = 'NONE' | 'AWAITING' | 'PARTIAL' | 'PAID'

interface Topup {
  amount: number
  paid: number
  days: number
  /** Номер счёта присваивается при формировании, потом не меняется. */
  invoiceNo: string
  method: PayMethod | null
  status: PayStatus
  /** Момент, после которого признак оплаты приходит из учётной системы. */
  settleAfter: number | null
  /** Что придёт из учётной системы — вся сумма или часть. Тумблер прототипа. */
  simulate: 'FULL' | 'PARTIAL'
  /**
   * Юрлицо: момент, когда счёт собран и отправлен. До него документа нет, и
   * показывать реквизиты не из чего. `null` — этап не нужен (счёт по ФЛ
   * существует сразу).
   */
  readyAfter: number | null
  /** Куда счёт уже ушёл. */
  sentTo: string | null
}

interface RentState {
  /** Смещение планового возврата, накопленное продлениями. */
  newReturnIso: string | null
  topup: Topup | null
  managerTask: { code: string; wantedIso: string } | null
}

interface DatasetState {
  failedAttempts: number
  lockedUntil: number
  /** Выданный код и момент его смерти. */
  codeExpiresAt: number
  lastSentAt: number
  sentToday: number
  sessions: Set<string>
  rents: Map<string, RentState>
}

const state = new Map<string, DatasetState>()

function stateOf(key: string): DatasetState {
  let s = state.get(key)
  if (!s) {
    s = {
      failedAttempts: 0,
      lockedUntil: 0,
      codeExpiresAt: 0,
      lastSentAt: 0,
      sentToday: 0,
      sessions: new Set(),
      rents: new Map(),
    }
    state.set(key, s)
  }
  return s
}

function rentStateOf(ds: DatasetState, id: string): RentState {
  let r = ds.rents.get(id)
  if (!r) {
    r = { newReturnIso: null, topup: null, managerTask: null }
    ds.rents.set(id, r)
  }
  return r
}

/**
 * Последние девять цифр: `+380 67 123 45 67`, `380671234567` и `0671234567` —
 * один и тот же номер. Сравнение полных строк отбивало клиента, набравшего
 * собственный номер в местном формате.
 */
function phoneKey(v: string) {
  return v.replace(/\D/g, '').slice(-9)
}

/** Сутки от текущего возврата до выбранной даты включительно. */
function daysUpTo(days: PublicExtendDay[], iso: string) {
  const idx = days.findIndex((d) => d.iso === iso)
  return idx < 0 ? [] : days.slice(0, idx + 1)
}

function code() {
  return `ЗД-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

function settle(t: Topup): PayStatus {
  if (t.status !== 'AWAITING' || t.settleAfter == null) return t.status
  if (Date.now() < t.settleAfter) return t.status
  // Клиент нажал «оплату виконано». Из учётной системы приходит СУММА, а не
  // булево «оплачено»: недоплата обязана оставлять счёт живым, иначе страница
  // виснет в ожидании навсегда — самый острый кейс, названный техлидом.
  if (t.simulate === 'PARTIAL') {
    t.paid = Math.round(t.amount * 0.45)
    t.status = 'PARTIAL'
  } else {
    t.paid = t.amount
    t.status = 'PAID'
  }
  t.settleAfter = null
  return t.status
}

function payStatus(r: RentState): PayStatus {
  return r.topup ? settle(r.topup) : 'NONE'
}

function invoiceReady(t: Topup) {
  return t.readyAfter == null || Date.now() >= t.readyAfter
}

function topupOut(r: RentState) {
  if (!r.topup) return null
  const status = settle(r.topup)
  return {
    amount: r.topup.amount,
    paid: r.topup.paid,
    days: r.topup.days,
    invoiceNo: r.topup.invoiceNo,
    method: r.topup.method,
    status,
    ready: invoiceReady(r.topup),
    sentTo: r.topup.sentTo,
  }
}

function rentOut(ds: PublicDataset, payload: PublicRentPayload, r: RentState) {
  return {
    ...payload,
    plannedReturnAt: r.newReturnIso ?? payload.plannedReturnAt,
    readOnly: hideCompany(ds, payload) ?? payload.readOnly,
    topup: topupOut(r),
    managerTask: r.managerTask,
  }
}

/** Аренда компании открывается только фактом существования — не составом. */
function hideCompany(ds: PublicDataset, payload: PublicRentPayload) {
  const profile = ds.profiles.find((p) => p.id === payload.profileId)
  return profile?.concealed
    ? {
        reason:
          'Оренда оформлена на компанію. Показати її може менеджер — зателефонуйте йому',
      }
    : null
}

/**
 * Префикс путей. `BASE_URL` — прототипная добавка: на GitHub Pages сайт лежит в
 * `/<repo>/`, service worker получает scope этой папки, и запрос к корневому
 * `/api/public/*` ушёл бы мимо моков. Локально `BASE_URL` = `/` — путь ровно
 * такой же, как в основной системе. Клиент строит адрес так же (`api.ts`).
 */
const P = `${import.meta.env.BASE_URL}api/public/:dataset`

function findDataset(params: Record<string, unknown>) {
  return PUBLIC_DATASETS[params.dataset as string]
}

function authed(ds: DatasetState, req: Request) {
  const sid =
    new URL(req.url).searchParams.get('s') ?? req.headers.get('x-rent-session')
  return sid != null && ds.sessions.has(sid)
}

export const publicRentLinkHandlers = [
  /** Шаг 1 — номер. Код уходит на него, не на аренду. */
  http.post(`${P}/auth/code`, async ({ params, request }) => {
    await delay(320)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)

    if (s.lockedUntil > Date.now())
      return HttpResponse.json(
        { code: 'LOCKED', lockedUntil: s.lockedUntil },
        { status: 429 },
      )

    const body = (await request.json()) as { phone?: string }
    const phone = body.phone ?? ''
    if (data.unknownPhone || phoneKey(phone) !== phoneKey(data.phone))
      return HttpResponse.json({ code: 'PHONE_UNKNOWN' }, { status: 404 })

    if (data.gatewayDown)
      return HttpResponse.json({ code: 'GATEWAY_DOWN' }, { status: 502 })

    if (s.sentToday >= MAX_SENDS_PER_DAY)
      return HttpResponse.json({ code: 'SMS_LIMIT' }, { status: 429 })

    s.sentToday += 1
    s.lastSentAt = Date.now()
    s.codeExpiresAt = Date.now() + CODE_TTL_MS
    s.failedAttempts = 0
    return HttpResponse.json({
      sent: true,
      // Каскад Viber → Telegram → SMS. В прототипе всегда первый канал:
      // умеет ли это SMS-шлюз «из коробки» — вопрос к разработке.
      channel: 'VIBER',
      phoneMasked: `+380 (${phoneKey(phone).slice(0, 2)}) ***-${phoneKey(phone).slice(5, 7)}-${phoneKey(phone).slice(7, 9)}`,
      resendAfter: Math.round(RESEND_COOLDOWN_MS / 1000),
    })
  }),

  /** Шаг 2 — код. Пять промахов подряд закрывают ввод на 15 минут. */
  http.post(`${P}/auth/verify`, async ({ params, request }) => {
    await delay(320)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)

    if (s.lockedUntil > Date.now())
      return HttpResponse.json(
        { code: 'LOCKED', lockedUntil: s.lockedUntil },
        { status: 429 },
      )

    const body = (await request.json()) as { code?: string; phone?: string }
    if (s.codeExpiresAt && Date.now() > s.codeExpiresAt)
      return HttpResponse.json({ code: 'CODE_EXPIRED' }, { status: 401 })

    if ((body.code ?? '').trim() !== SMS_CODE) {
      s.failedAttempts += 1
      if (s.failedAttempts >= MAX_ATTEMPTS) {
        s.lockedUntil = Date.now() + LOCK_MS
        s.failedAttempts = 0
        return HttpResponse.json(
          { code: 'LOCKED', lockedUntil: s.lockedUntil },
          { status: 429 },
        )
      }
      return HttpResponse.json(
        { code: 'BAD_CODE', attemptsLeft: MAX_ATTEMPTS - s.failedAttempts },
        { status: 401 },
      )
    }

    s.failedAttempts = 0
    const sid = `sess-${Math.random().toString(36).slice(2, 10)}`
    s.sessions.add(sid)
    return HttpResponse.json({ session: sid })
  }),

  /** Всё, что открыто номеру: профили на нём и список аренд. */
  http.get(`${P}/session`, async ({ params, request }) => {
    await delay(180)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)
    if (!authed(s, request))
      return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })

    const rents = data.rents
      .filter((p) => {
        const profile = data.profiles.find((x) => x.id === p.profileId)
        return !profile?.concealed
      })
      .map((p) => {
        const r = rentStateOf(s, p.id)
        const plannedReturnAt = r.newReturnIso ?? p.plannedReturnAt
        return {
          id: p.id,
          rentCode: p.rentCode,
          status: p.status,
          plannedReturnAt,
          leadItem: p.items[0]?.name ?? '',
          itemsCount: p.items.reduce((n, it) => n + it.qty, 0),
          branchName: p.branch.name,
          due: Math.max(0, p.rentAccount.accrued - p.rentAccount.paid),
          canExtend: p.readOnly == null && p.extend != null,
          profileId: p.profileId,
        }
      })

    return HttpResponse.json({
      phoneMasked: `+380 (${phoneKey(data.phone).slice(0, 2)}) ***-${phoneKey(data.phone).slice(5, 7)}-${phoneKey(data.phone).slice(7, 9)}`,
      profiles: data.profiles.map((p) => ({
        ...p,
        rentCount: data.rents.filter((r) => r.profileId === p.id).length,
      })),
      rents,
    })
  }),

  http.get(`${P}/rents/:id`, async ({ params, request }) => {
    await delay(180)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)
    if (!authed(s, request))
      return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
    const payload = data.rents.find((r) => r.id === params.id)
    if (!payload)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    return HttpResponse.json(rentOut(data, payload, rentStateOf(s, payload.id)))
  }),

  /**
   * Продление. Свободно → срок сдвигается сразу и формируется счёт на
   * доплату. Занято → срок не двигается, счёта нет, менеджеру создаётся
   * заявка.
   */
  http.post(`${P}/rents/:id/extend`, async ({ params, request }) => {
    await delay(520)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)
    if (!authed(s, request))
      return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
    const payload = data.rents.find((r) => r.id === params.id)
    if (!payload)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    if (payload.readOnly || !payload.extend)
      return HttpResponse.json({ code: 'READ_ONLY' }, { status: 403 })

    const r = rentStateOf(s, payload.id)
    const body = (await request.json()) as {
      returnIso?: string
      seenReturnAt?: string
    }

    // Менеджер мог поменять аренду, пока клиент выбирал дату. Продлевать
    // поверх чужой правки нельзя — клиент увидит «дані оновилися».
    const current = r.newReturnIso ?? payload.plannedReturnAt
    if (body.seenReturnAt && body.seenReturnAt !== current)
      return HttpResponse.json({ code: 'STALE' }, { status: 409 })

    const chosen = body.returnIso ?? ''
    const span = daysUpTo(payload.extend.days, chosen)
    if (span.length === 0)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 400 })

    const blocked = span.find((d) => !d.available)
    if (blocked) {
      // Заявка на те же даты не удваивается: клиент, нажавший дважды, не
      // должен породить менеджеру две задачи об одном и том же.
      if (!r.managerTask || r.managerTask.wantedIso !== chosen)
        r.managerTask = { code: code(), wantedIso: chosen }
      return HttpResponse.json({
        ok: false,
        reason: 'UNAVAILABLE',
        managerTask: r.managerTask,
      })
    }

    const amount = span.reduce((sum, d) => sum + d.amount, 0) + payload.debt
    const at = new Date(chosen)
    at.setHours(10, 0, 0, 0)
    r.newReturnIso = at.toISOString()
    r.topup = {
      amount,
      paid: 0,
      days: span.length,
      invoiceNo: `${payload.rentCode}-Д${String(Date.now()).slice(-3)}`,
      method: null,
      status: 'NONE',
      settleAfter: null,
      simulate: 'FULL',
      readyAfter: null,
      sentTo: null,
    }
    r.managerTask = { code: code(), wantedIso: chosen }
    return HttpResponse.json({ ok: true, newReturnAt: r.newReturnIso })
  }),

  /** Выбор способа оплаты. Счёт выставлен → не корректируется. */
  http.post(`${P}/rents/:id/pay`, async ({ params, request }) => {
    await delay(420)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)
    if (!authed(s, request))
      return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
    const payload = data.rents.find((r) => r.id === params.id)
    if (!payload)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const r = rentStateOf(s, payload.id)
    if (!r.topup) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 409 })

    const body = (await request.json()) as {
      method?: PayMethod
      declared?: boolean
      simulate?: 'FULL' | 'PARTIAL'
    }
    const method = body.method ?? null
    const outstanding = r.topup.amount - r.topup.paid

    if (method === 'BALANCE' && payload.counterparty.balance < outstanding)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 409 })

    r.topup.method = method
    if (method === 'BANK') {
      // Первый вызов только выпускает счёт: клиент ещё ничего не перевёл, и
      // ставить «очікує оплату» до его слова — врать самим себе.
      if (body.declared) {
        r.topup.status = 'AWAITING'
        r.topup.settleAfter = Date.now() + BANK_CONFIRM_MS
        r.topup.simulate = body.simulate ?? 'FULL'
      } else {
        r.topup.status = 'NONE'
        r.topup.settleAfter = null
      }
    } else if (method === 'CARD') {
      // Провайдер отдаёт callback сразу и недоплатить не даёт: checkout
      // принимает ровно сумму счёта.
      r.topup.paid = r.topup.amount
      r.topup.status = 'PAID'
      r.topup.settleAfter = null
    } else if (method === 'BALANCE') {
      r.topup.paid = r.topup.amount
      r.topup.status = 'PAID'
      r.topup.settleAfter = null
    } else {
      // Юрлицо. Счёт собирается и уходит клиенту, дальше страница только ждёт:
      // деньги идут со счёта компании, и приход подтверждает менеджер, а не
      // кнопка на этом экране. Недоплата возможна и здесь — бухгалтерия
      // клиента платит по своей ведомости, а не по нашей сумме.
      r.topup.status = 'AWAITING'
      r.topup.readyAfter = Date.now() + INVOICE_READY_MS
      r.topup.settleAfter = Date.now() + INVOICE_READY_MS + BANK_CONFIRM_MS
      r.topup.simulate = body.simulate ?? 'FULL'
      r.topup.sentTo = payload.legal?.email ?? null
    }
    return HttpResponse.json({
      status: payStatus(r),
      invoiceNo: r.topup.invoiceNo,
    })
  }),

  /** Признак оплаты приходит из учётной системы — страница его только читает. */
  http.get(`${P}/rents/:id/payment`, async ({ params, request }) => {
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)
    if (!authed(s, request))
      return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
    const payload = data.rents.find((r) => r.id === params.id)
    if (!payload)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const r = rentStateOf(s, payload.id)
    return HttpResponse.json({
      status: payStatus(r),
      paid: r.topup?.paid ?? 0,
      ready: r.topup ? invoiceReady(r.topup) : false,
    })
  }),

  /**
   * Повторная отправка счёта. Канал выбирает клиент: счёт уходит на почту
   * бухгалтерии или в мессенджер, из которого он открыл страницу.
   */
  http.post(`${P}/rents/:id/invoice/send`, async ({ params, request }) => {
    await delay(500)
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const s = stateOf(data.key)
    if (!authed(s, request))
      return HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
    const payload = data.rents.find((r) => r.id === params.id)
    if (!payload)
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    const r = rentStateOf(s, payload.id)
    if (!r.topup || !invoiceReady(r.topup))
      return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 409 })

    const body = (await request.json()) as { channel?: 'EMAIL' | 'MESSENGER' }
    const sentTo =
      body.channel === 'MESSENGER'
        ? `Viber ${payload.counterparty.phoneMasked}`
        : (payload.legal?.email ?? 'пошту контрагента')
    r.topup.sentTo = sentTo
    return HttpResponse.json({ sentTo })
  }),

  /**
   * Демо-доступ набора. Эндпоинта в проде нет и быть не может: код знает
   * только владелец номера. Здесь он существует ради показа — поля входа
   * приходят заполненными.
   */
  http.get(`${P}/demo`, ({ params }) => {
    const data = findDataset(params)
    if (!data) return HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 })
    return HttpResponse.json({ phone: data.phone, code: SMS_CODE })
  }),
]
