/** Форматтеры публичной страницы. Только украинский — страница клиентская. */

const NBSP = ' '

/** `4 800 грн`. Разряды — неразрывным пробелом, чтобы сумма не рвалась. */
export function money(v: number): string {
  const sign = v < 0 ? '−' : ''
  const abs = Math.abs(Math.round(v))
  return `${sign}${abs.toLocaleString('uk-UA').replace(/\s/g, NBSP)}${NBSP}грн`
}

/** `12.08` — короткая дата для строк расчёта. */
export function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${`${d.getDate()}`.padStart(2, '0')}.${`${d.getMonth() + 1}`.padStart(2, '0')}`
}

/** `12.08, 10:00` — плановый возврат в шапке. */
export function dateTime(iso: string): string {
  const d = new Date(iso)
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `${shortDate(iso)}, ${hh}:${mm}`
}

const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export function weekday(iso: string): string {
  return WEEKDAYS[new Date(iso).getDay()] ?? ''
}

/** Выходные помечаются в пикере — по ним чаще всего и спрашивают цену. */
export function isWeekend(iso: string): boolean {
  const day = new Date(iso).getDay()
  return day === 0 || day === 6
}

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function daysWord(n: number) {
  return plural(n, 'доба', 'доби', 'діб')
}

/** «1 позиція / 2 позиції / 5 позицій» — состав продлеваемой аренды. */
export function itemsWord(n: number) {
  return plural(n, 'позиція', 'позиції', 'позицій')
}

/** Целые сутки между двумя моментами; отрицательное = просрочка. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000,
  )
}

/**
 * Остаток блокировки словами: «через 15 хв» — и только на последней минуте
 * «через 40 с». `mm:ss` в этом месте читается как время на часах, а не как
 * сколько ждать.
 */
export function remaining(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000))
  if (total < 60) return `через ${total} с`
  const mm = Math.ceil(total / 60)
  return `через ${mm} ${plural(mm, 'хвилину', 'хвилини', 'хвилин')}`
}

/**
 * Национальный номер к девяти значащим цифрам: `+380 67 123 45 67`,
 * `380671234567`, `0671234567` и `67 123 45 67` — один и тот же человек.
 * Сравнивать полные строки нельзя: клиент, набравший свой номер как «067…»,
 * иначе получает «номера не знайдено» на собственном телефоне.
 */
export function phoneKey(raw: string): string {
  const d = raw.replace(/\D/g, '')
  return d.slice(-9)
}

/** Введено достаточно, чтобы вообще отправлять запрос. */
export function isPhoneComplete(raw: string): boolean {
  return phoneKey(raw).length === 9
}

/** `+380 (67) ***-45-67` — маска для экрана кода и шапки списка. */
export function maskPhone(raw: string): string {
  const k = phoneKey(raw)
  if (k.length < 9) return raw
  return `+380 (${k.slice(0, 2)}) ***-${k.slice(5, 7)}-${k.slice(7, 9)}`
}

const CHANNEL: Record<string, string> = {
  VIBER: 'Viber',
  TELEGRAM: 'Telegram',
  SMS: 'SMS',
}

export function channelName(c: string): string {
  return CHANNEL[c] ?? 'SMS'
}
