/**
 * Фикстуры публичной страницы самообслуживания клиента (прототип).
 *
 * Модель — НЕ «одна ссылка = одна аренда». Клиент входит по своему номеру и
 * видит все аренды этого номера; ссылка ничего не открывает и не протухает.
 * Поэтому фикстура — это ДАТАСЕТ: номер, профили на нём и список аренд.
 * Датасет выбирается адресом `/o/<dataset>` — демо переключается без правки
 * кода.
 *
 * ВАЖНО про суммы: аренда и залог здесь НИКОГДА не складываются — это два
 * независимых счёта. Строки «Разом» в payload нет намеренно: её неоткуда
 * взять.
 *
 * Коэффициенты суток берутся из `days[]`, а не считаются кодом: правило
 * выходного дня и праздничный коэффициент задаёт администратор, и прототип
 * не имеет права их изобретать. В сценарии `holiday` стоит реальный
 * государственный праздник — 24.08, День Незалежності.
 */

export interface PublicRentItem {
  id: string
  name: string
  qty: number
  dayRate: number
}

/** Сутки, доступные для продления. Цена — своя у каждых суток. */
export interface PublicExtendDay {
  /** `YYYY-MM-DD` — дата НОВОГО планового возврата. */
  iso: string
  /** Стоимость этих суток с уже применённым коэффициентом. */
  amount: number
  /** Показывается отдельной строкой, когда применён. */
  coefficient: { label: string; factor: number } | null
  /** Свободен ли остаток номенклатуры на эти сутки. */
  available: boolean
}

export interface PublicRentPayload {
  id: string
  rentCode: string
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'OVERDUE' | 'CLOSED'
  /** Не `null` → аренда только на просмотр (ЮЛ, закрытая, ЧС/Суд). */
  readOnly: { reason: string } | null
  /** Профиль, на который оформлена аренда. */
  profileId: string
  counterparty: {
    name: string
    phoneMasked: string
    /** Операционный баланс. Способ «списать с баланса» живёт только при > 0. */
    balance: number
  }
  branch: {
    name: string
    address: string
    phone: string
    /** Реквизиты получателя = ФОП склада выдачи. */
    fopName: string
    fopIban: string
    fopEdrpou: string
  }
  issuedAt: string
  plannedReturnAt: string
  items: PublicRentItem[]
  /** Счёт аренды. */
  rentAccount: { days: number; accrued: number; paid: number }
  /** Счёт залога — отдельный, с арендой не суммируется. */
  depositAccount: { amount: number; paid: number }
  /** Долг по просрочке. Входит в сумму доплаты отдельной строкой. */
  debt: number
  /** `null` — продление в этом контуре недоступно. */
  extend: { days: PublicExtendDay[] } | null
}

export interface PublicProfileFixture {
  id: string
  name: string
  kind: 'PERSON' | 'COMPANY'
  /**
   * Аренды юрлица на личном номере директора не раскрываются: клиент видит,
   * что они есть, но не их состав и суммы. Компромисс между «показуємо оренди
   * всіх профілів» и утечкой корпоративных сумм тому, кто держит телефон.
   * Помечен как предложение — см. README.
   */
  concealed: boolean
}

export interface PublicDataset {
  key: string
  /** Подпись в dev-переключателе сценариев. */
  label: string
  phone: string
  profiles: PublicProfileFixture[]
  rents: PublicRentPayload[]
  /** Номера нет в базе — гейт отвечает прямо, без ожидания SMS. */
  unknownPhone?: boolean
  /** Шлюз OTP недоступен. */
  gatewayDown?: boolean
}

const DAY_MS = 86_400_000

/** Полночь по локали, чтобы смещения в сутках не «плавали» от часа запуска. */
function midnight(offsetDays: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return new Date(d.getTime() + offsetDays * DAY_MS)
}

export function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Дата возврата = полночь + 10:00, как в договоре. */
function returnAt(offsetDays: number): string {
  const d = midnight(offsetDays)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

/**
 * ⚠️ Реквізити нижче — вигадані. Прототип виїжджає за межі внутрішнього
 * контуру, тому прізвища ФОПів, IBAN, ІПН і телефони відділень замінені на
 * очевидні заглушки. Реальні реквізити сюди не повертаємо: сторінка показує їх
 * клієнту для переказу, тобто їх бачить кожен, хто відкриє посилання.
 */
const KYIV_BRANCH = {
  name: 'Вишневе',
  address: 'вул. Промислова, 5, Вишневе',
  phone: '+380 (44) 000-00-01',
  fopName: 'ФОП Кравченко І. П.',
  fopIban: 'UA000000000000000000000000001',
  fopEdrpou: '0000000001',
}

const PODIL_BRANCH = {
  name: 'Поділ',
  address: 'вул. Кирилівська, 82, Київ',
  phone: '+380 (44) 000-00-02',
  fopName: 'ФОП Савченко М. О.',
  fopIban: 'UA000000000000000000000000002',
  fopEdrpou: '0000000002',
}

/**
 * Сутки продления по одной цене, все свободны. `from` — первые доступные
 * сутки (текущий возврат + 1), длина ряда — 7 суток (потолок контура).
 */
function plainDays(
  fromOffset: number,
  rate: number,
  count = 7,
): PublicExtendDay[] {
  return Array.from({ length: count }, (_, i) => ({
    iso: isoDate(midnight(fromOffset + i)),
    amount: rate,
    coefficient: null,
    available: true,
  }))
}

const AERATOR: PublicRentItem = {
  id: 'itm-aer',
  name: 'Аератор електричний NEC 1500',
  qty: 1,
  dayRate: 600,
}

const VIBRO: PublicRentItem = {
  id: 'itm-vib',
  name: 'Віброплита реверсивна Wacker Neuson DPU 3050 з подовженим тримачем',
  qty: 1,
  dayRate: 850,
}

const DRILL: PublicRentItem = {
  id: 'itm-drl',
  name: 'Перфоратор Bosch GBH 5-40',
  qty: 2,
  dayRate: 180,
}

const PERSON = {
  id: 'cp-yanko',
  name: 'Янко Тарас Васильович',
  kind: 'PERSON' as const,
  concealed: false,
}

const MASKED = '+380 (67) ***-45-67'

/**
 * Базовая аренда (acceptance B): выдача 6 суток назад, плановый возврат
 * через 2 суток, 8 суток × 600 ₴ = 4 800 ₴ начислено и оплачено, залог
 * 3 000 ₴. Продление на 3 суток = 1 800 ₴ — залог его покрывает.
 */
function expiringRent(over: Partial<PublicRentPayload> = {}): PublicRentPayload {
  return {
    id: 'r-expiring',
    rentCode: 'АР-319А0',
    status: 'EXPIRING_SOON',
    readOnly: null,
    profileId: PERSON.id,
    counterparty: { name: PERSON.name, phoneMasked: MASKED, balance: 0 },
    branch: KYIV_BRANCH,
    issuedAt: returnAt(-6),
    plannedReturnAt: returnAt(2),
    items: [AERATOR],
    rentAccount: { days: 8, accrued: 4800, paid: 4800 },
    depositAccount: { amount: 3000, paid: 3000 },
    debt: 0,
    extend: { days: plainDays(3, 600) },
    ...over,
  }
}

/**
 * Просрочка на 2 суток с долгом 1 200 ₴. Залог здесь маленький и доплату НЕ
 * покрывает — иначе бесплатный способ съедал бы все сценарии оплаты, и
 * развилку A/Б не на чем было бы показать.
 */
function overdueRent(): PublicRentPayload {
  return expiringRent({
    id: 'r-overdue',
    rentCode: 'АР-4М721',
    status: 'OVERDUE',
    // Выдано 10 суток назад, плановый возврат был 2 суток назад: 8 плановых
    // + 2 просроченных = ровно 10 начисленных суток на шкале.
    issuedAt: returnAt(-10),
    plannedReturnAt: returnAt(-2),
    items: [VIBRO, DRILL],
    rentAccount: { days: 10, accrued: 6000, paid: 4800 },
    depositAccount: { amount: 1000, paid: 1000 },
    debt: 1200,
    extend: { days: plainDays(1, 600) },
    branch: PODIL_BRANCH,
  })
}

/**
 * Закрытая аренда: оборудование принято, залог возвращён. Клиент открывает
 * её через недели после сдачи, чтобы посмотреть расчёт.
 */
function closedRent(): PublicRentPayload {
  return expiringRent({
    id: 'r-closed',
    rentCode: 'АР-8Т2М5',
    status: 'CLOSED',
    issuedAt: returnAt(-12),
    plannedReturnAt: returnAt(-4),
    depositAccount: { amount: 3000, paid: 0 },
    readOnly: {
      reason: 'Оренду закрито — обладнання прийнято, заставу повернуто',
    },
    extend: null,
  })
}

/**
 * Продление пересекает государственный праздник — 24.08, День Незалежності.
 * Коэффициент 0,5 приходит из фикстуры (админ настраивает его в справочнике),
 * прототип его не выводит формулой.
 */
function holidayDays(): PublicExtendDay[] {
  const year = new Date().getFullYear()
  const first = new Date(`${year}-08-24T00:00:00`)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(first.getTime() + i * DAY_MS)
    const isHoliday = d.getMonth() === 7 && d.getDate() === 24
    return {
      iso: isoDate(d),
      amount: isHoliday ? 300 : 600,
      coefficient: isHoliday
        ? { label: 'День Незалежності, 24.08', factor: 0.5 }
        : null,
      available: true,
    }
  })
}

export const PUBLIC_DATASETS: Record<string, PublicDataset> = {}

function register(ds: PublicDataset) {
  PUBLIC_DATASETS[ds.key] = ds
}

// Основной датасет: три аренды на одном номере — та, что заканчивается,
// просроченная и закрытая. Ровно то, ради чего вход сделан по номеру.
register({
  key: 'demo',
  label: 'Базовий — три оренди на номері',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [expiringRent(), overdueRent(), closedRent()],
})

// Одна активная аренда: список пропускается, клиент сразу видит карточку.
register({
  key: 'single',
  label: 'Одна оренда — список пропускається',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [expiringRent()],
})

// Залог покрывает доплату — самый дешёвый способ стоит первым и по умолчанию.
register({
  key: 'deposit',
  label: 'Застава покриває доплату',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [expiringRent({ depositAccount: { amount: 5000, paid: 5000 } })],
})

/**
 * Баланс > 0 — способ «Списати з балансу» появляется с суммой остатка.
 * 2 500 ₴ выбраны так, чтобы в одном сценарии игрались ОБА исхода: продление
 * на 1–4 суток списывается целиком, на 5 и больше — не хватает, и способ
 * гаснет с названной нехваткой.
 */
register({
  key: 'balance',
  label: 'Є баланс контрагента — 2 500 ₴',
  phone: '+380671234567',
  profiles: [{ ...PERSON, name: 'Мельник Дмитро Іванович' }],
  rents: [
    expiringRent({
      rentCode: 'АР-3Ф5Н9',
      counterparty: {
        name: 'Мельник Дмитро Іванович',
        phoneMasked: MASKED,
        balance: 2500,
      },
      depositAccount: { amount: 800, paid: 800 },
    }),
  ],
})

register({
  key: 'holiday',
  label: 'Продовження через свято',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [
    expiringRent({
      rentCode: 'АР-77С1К',
      status: 'ACTIVE',
      // Сценарий привязан к реальной дате праздника, поэтому даты абсолютные
      // (локальные, без `Z` — иначе шапка съезжает на смещение часового пояса).
      issuedAt: `${new Date().getFullYear()}-08-03T10:00:00`,
      plannedReturnAt: `${new Date().getFullYear()}-08-23T10:00:00`,
      rentAccount: { days: 20, accrued: 12000, paid: 12000 },
      depositAccount: { amount: 900, paid: 900 },
      extend: { days: holidayDays() },
    }),
  ],
})

// Позиция занята со вторых суток продления: дата не сдвигается, счёт не
// формируется, менеджеру уходит заявка.
register({
  key: 'busy',
  label: 'Дати зайняті — заявка менеджеру',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [
    expiringRent({
      rentCode: 'АР-51ТВ8',
      extend: {
        days: plainDays(3, 600).map((d, i) => ({ ...d, available: i < 1 })),
      },
    }),
  ],
})

/**
 * Два профиля на одном номере — 33 % базы это дубли, плюс личный телефон
 * директора штатно держит и ФЛ, и ЮЛ. Аренды физлица открыты полностью,
 * аренды компании — только фактом существования.
 */
register({
  key: 'dupes',
  label: 'Два контрагенти на номері (ФО + ЮО)',
  phone: '+380671234567',
  profiles: [
    PERSON,
    {
      id: 'cp-budgrup',
      name: 'ТОВ «БудГруп»',
      kind: 'COMPANY',
      concealed: true,
    },
  ],
  rents: [
    expiringRent(),
    overdueRent(),
    expiringRent({
      id: 'r-ul-1',
      rentCode: 'АР-9К3Р2',
      profileId: 'cp-budgrup',
      counterparty: {
        name: 'ТОВ «БудГруп»',
        phoneMasked: MASKED,
        balance: 0,
      },
      readOnly: {
        reason: 'Оренда оформлена на юридичну особу — продовження веде менеджер',
      },
      extend: null,
    }),
    expiringRent({
      id: 'r-ul-2',
      rentCode: 'АР-9К3Р8',
      profileId: 'cp-budgrup',
      counterparty: {
        name: 'ТОВ «БудГруп»',
        phoneMasked: MASKED,
        balance: 0,
      },
      readOnly: {
        reason: 'Оренда оформлена на юридичну особу — продовження веде менеджер',
      },
      extend: null,
    }),
  ],
})

// Контрагент в чёрном списке / суде — только просмотр.
register({
  key: 'blocked',
  label: 'ЧС — тільки перегляд',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [
    expiringRent({
      rentCode: 'АР-6Х8Л1',
      readOnly: { reason: 'Продовження недоступне — зверніться до менеджера' },
      extend: null,
    }),
  ],
})

// Активных аренд нет. Пустой экран читается как «зламалось», поэтому
// показываем закрытые за последний месяц.
register({
  key: 'empty',
  label: 'Активних оренд немає',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [closedRent()],
})

// Номера нет в базе. Отвечаем прямо: нейтральное «якщо номер є, код надійде»
// оставляет клиента ждать SMS, которой не будет.
register({
  key: 'unknown',
  label: 'Номера немає в базі',
  phone: '+380671234567',
  profiles: [],
  rents: [],
  unknownPhone: true,
})

// Шлюз рассылки лежит — код отправить нечем.
register({
  key: 'gateway',
  label: 'Шлюз кодів недоступний',
  phone: '+380671234567',
  profiles: [PERSON],
  rents: [expiringRent()],
  gatewayDown: true,
})
