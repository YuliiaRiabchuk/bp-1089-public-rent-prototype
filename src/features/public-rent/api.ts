/**
 * Клиент публичной страницы аренды. Отдельный слой: у страницы нет сессии
 * сотрудника и нет доступа к внутреннему API — только к своему
 * `/api/public/*`.
 *
 * Модель входа — по НОМЕРУ, а не по ссылке. Ссылка не секрет и ничего не
 * открывает: секрет — код, который приходит на номер.
 * Один вход показывает ВСЕ аренды этого номера, поэтому ссылка не привязана
 * к аренде и не протухает через сутки.
 */

/** Развилка оплаты. Выбирает владелец; страница собрана под обе. */
export type PayMode = 'BANKS' | 'PROVIDER'

export type PayMethod =
  /** Списание с операционного баланса контрагента. */
  | 'BALANCE'
  /** Перевод по реквизитам ФОПа (развилка A). */
  | 'BANK'
  /** Checkout провайдера: Apple Pay / Google Pay / карта (развилка Б). */
  | 'CARD'
  /**
   * Юрлицо. Страница денег не берёт вообще: она формирует счёт, счёт уходит
   * клиенту, оплату по нему подтверждает менеджер. Развилка A/Б к ЮЛ не
   * относится — безнал по счёту у юрлица единственный способ.
   */
  | 'INVOICE'

export type PayStatus = 'NONE' | 'AWAITING' | 'PAID'

export interface ExtendDay {
  iso: string
  amount: number
  coefficient: { label: string; factor: number } | null
  available: boolean
  /**
   * Выходной: склад закрыт, вернуть в этот день нельзя. Сутки остаются в
   * расчёте — оборудование всё это время у клиента, — но датой возврата стать
   * не могут: система переносит возврат на ближайший рабочий день.
   */
  closed: boolean
}

/** Строка списка аренд. Ровно то, по чему клиент узнаёт свою аренду. */
export interface RentSummary {
  id: string
  rentCode: string
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'OVERDUE' | 'CLOSED'
  plannedReturnAt: string
  /** Первая позиция — по ней аренда и опознаётся. */
  leadItem: string
  itemsCount: number
  branchName: string
  /** К оплате по счёту аренды; 0 — всё закрыто. */
  due: number
  canExtend: boolean
  /** Профиль, на который оформлена аренда. */
  profileId: string
}

/**
 * Профиль на номере. Их может быть несколько: 33 % базы — дубли, и один
 * номер штатно держит и физлицо, и юрлицо (телефон директора).
 */
export interface PublicProfile {
  id: string
  name: string
  kind: 'PERSON' | 'COMPANY'
  /** Аренды юрлица не раскрываются: суммы компании — не для того, кто
   *  держит телефон директора. Видно только, что они есть. */
  concealed: boolean
  rentCount: number
}

export interface PublicSession {
  phoneMasked: string
  profiles: PublicProfile[]
  rents: RentSummary[]
}

export interface PublicRent {
  id: string
  rentCode: string
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'OVERDUE' | 'CLOSED'
  readOnly: { reason: string } | null
  counterparty: { name: string; phoneMasked: string; balance: number }
  branch: {
    name: string
    address: string
    phone: string
    fopName: string
    fopIban: string
    fopEdrpou: string
  }
  /**
   * Не `null` → аренда юрлица. Отличий три, и все три обязательны, иначе счёт
   * не примет бухгалтерия клиента: получатель — ТОВ, а не ФОП склада (ФОП на
   * упрощёнке, НДС не выделяет); аренда идёт с НДС +20 % отдельной строкой
   * «у т.ч. ПДВ»; залог — свой счёт без НДС и на другой расчётный счёт.
   */
  legal: {
    payeeName: string
    payeeEdrpou: string
    payeeIban: string
    /** Доля НДС внутри суммы счёта. 0.2 → строка «у т.ч. ПДВ 20 %». */
    vatRate: number
    /** Куда система отправляет сформированный счёт. */
    email: string
  } | null
  issuedAt: string
  plannedReturnAt: string
  items: Array<{ id: string; name: string; qty: number; dayRate: number }>
  rentAccount: { days: number; accrued: number; paid: number }
  depositAccount: { amount: number; paid: number }
  debt: number
  extend: { days: ExtendDay[] } | null
  topup: {
    amount: number
    /** Сколько уже зачислено по этому счёту. */
    paid: number
    days: number
    invoiceNo: string
    method: PayMethod | null
    status: PayStatus
    /**
     * Счёт формируется не мгновенно: его собирает система и отправляет
     * клиенту. До этого момента показывать реквизиты и кнопку «завантажити»
     * нечестно — документа ещё нет.
     */
    ready: boolean
    /** Куда счёт уже ушёл. `null` — ещё никуда. */
    sentTo: string | null
  } | null
  managerTask: { code: string; wantedIso: string } | null
}

export type PublicFailure =
  | { code: 'PHONE_UNKNOWN' }
  | { code: 'LOCKED'; lockedUntil: number }
  | { code: 'BAD_CODE'; attemptsLeft: number }
  | { code: 'CODE_EXPIRED' }
  | { code: 'SMS_LIMIT' }
  | { code: 'GATEWAY_DOWN' }
  | { code: 'UNAUTHORIZED' }
  | { code: 'STALE' }
  | { code: 'NOT_FOUND' }

export class PublicRentError extends Error {
  constructor(readonly failure: PublicFailure) {
    super(failure.code)
  }
}

/**
 * `dataset` — только для прототипа: подставляется из `/o/<dataset>` и выбирает
 * демо-набор в моках. В проде адрес один и параметра нет.
 *
 * Префикс `BASE_URL` — тоже прототипный. На GitHub Pages сайт живёт не в корне,
 * а в `/<repo>/`, и service worker MSW получает scope этой папки: запрос к
 * корневому `/api/public/*` вышел бы за scope и уехал бы мимо моков в 404.
 * Локально `BASE_URL` = `/`, то есть путь тот же, что в основной системе.
 */
const base = (dataset: string) =>
  `${import.meta.env.BASE_URL}api/public/${encodeURIComponent(dataset)}`

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Ответ без тела — падаем на общий NOT_FOUND ниже.
  }
  const failure = (body ?? { code: 'NOT_FOUND' }) as PublicFailure
  throw new PublicRentError(failure)
}

const json = (session?: string) => ({
  'content-type': 'application/json',
  ...(session ? { 'x-rent-session': session } : {}),
})

export function requestCode(dataset: string, phone: string) {
  return fetch(`${base(dataset)}/auth/code`, {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ phone }),
  }).then(
    unwrap<{
      sent: true
      /** Каскад Viber → Telegram → SMS: клиенту говорим, куда смотреть. */
      channel: 'VIBER' | 'TELEGRAM' | 'SMS'
      phoneMasked: string
      /** Секунд до повторной отправки. */
      resendAfter: number
    }>,
  )
}

export function verifyCode(dataset: string, phone: string, code: string) {
  return fetch(`${base(dataset)}/auth/verify`, {
    method: 'POST',
    headers: json(),
    body: JSON.stringify({ phone, code }),
  }).then(unwrap<{ session: string }>)
}

export function fetchSession(dataset: string, session: string) {
  return fetch(`${base(dataset)}/session`, {
    headers: json(session),
  }).then(unwrap<PublicSession>)
}

export function fetchRent(dataset: string, session: string, id: string) {
  return fetch(`${base(dataset)}/rents/${encodeURIComponent(id)}`, {
    headers: json(session),
  }).then(unwrap<PublicRent>)
}

/**
 * `plannedReturnAt` — тот срок, который клиент видел на экране. Менеджер мог
 * поменять аренду за это время; расхождение возвращает 409, а не молча
 * продлевает поверх чужой правки.
 */
export function extendRent(
  dataset: string,
  session: string,
  id: string,
  returnIso: string,
  seenReturnAt: string,
) {
  return fetch(`${base(dataset)}/rents/${encodeURIComponent(id)}/extend`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ returnIso, seenReturnAt }),
  }).then(
    unwrap<
      | { ok: true; newReturnAt: string }
      | {
          ok: false
          reason: 'UNAVAILABLE'
          managerTask: { code: string; wantedIso: string }
        }
    >,
  )
}

/**
 * Перевод по реквизитам идёт в два шага: сперва счёт (`declared: false`) —
 * клиент уходит в банк; потом его «я сплатив» (`declared: true`). Кнопка не
 * подтверждает деньги, она лишь заводит менеджеру задачу их проверить.
 * Остальные способы закрываются одним вызовом.
 */
export function payTopup(
  dataset: string,
  session: string,
  id: string,
  method: PayMethod,
  opts: { declared?: boolean } = {},
) {
  return fetch(`${base(dataset)}/rents/${encodeURIComponent(id)}/pay`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ method, ...opts }),
  }).then(unwrap<{ status: PayStatus; invoiceNo: string }>)
}

/** Признак «счёт оплачен» приходит из учётной системы — страница его читает. */
export function fetchPaymentStatus(
  dataset: string,
  session: string,
  id: string,
) {
  return fetch(`${base(dataset)}/rents/${encodeURIComponent(id)}/payment`, {
    headers: json(session),
  }).then(unwrap<{ status: PayStatus; paid: number; ready: boolean }>)
}

/**
 * Отправка готового счёта. Счёт уже пришёл клиенту при формировании — это
 * повторная отправка на его выбор: бухгалтерия клиента сидит не в том же
 * мессенджере, где директор открыл страницу.
 */
export function sendInvoice(
  dataset: string,
  session: string,
  id: string,
  channel: 'EMAIL' | 'MESSENGER',
) {
  return fetch(`${base(dataset)}/rents/${encodeURIComponent(id)}/invoice/send`, {
    method: 'POST',
    headers: json(session),
    body: JSON.stringify({ channel }),
  }).then(unwrap<{ sentTo: string }>)
}

/**
 * Демо-доступ: номер, код и список наборов. Только для прототипа — поля входа
 * приходят заполненными, а переключатель сценариев берёт список отсюда, а не
 * держит собственную копию. В проде эндпоинта нет: код знает только владелец
 * номера.
 */
export function fetchDemo(dataset: string) {
  return fetch(`${base(dataset)}/demo`).then(
    unwrap<{
      phone: string
      code: string
      datasets: Array<{ key: string; label: string }>
    }>,
  )
}
