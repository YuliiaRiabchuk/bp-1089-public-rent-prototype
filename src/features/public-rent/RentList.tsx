import { Building2, ChevronRight, Info, Phone } from 'lucide-react'
import { dateTime, daysBetween, daysWord, money } from './format'
import type { PublicSession, RentSummary } from './api'

/**
 * Список аренд номера — экран, которого не было в модели «одна ссылка = одна
 * аренда». Клиент с тремя арендами на объекте не должен искать, какая из трёх
 * ссылок в переписке ведёт на ту, что заканчивается сегодня.
 *
 * Сортировка — по дате возврата, ближайшие сверху: строка, которая горит,
 * стоит первой без чтения дат. Закрытые уезжают вниз отдельной группой и
 * остаются доступны — за ними и приходят через недели после сдачи.
 */
export function RentList({
  session,
  managerPhone,
  onOpen,
  onSignOut,
}: {
  session: PublicSession
  managerPhone: string
  onOpen: (id: string) => void
  onSignOut: () => void
}) {
  const byDate = (a: RentSummary, b: RentSummary) =>
    new Date(a.plannedReturnAt).getTime() -
    new Date(b.plannedReturnAt).getTime()
  const open = session.rents.filter((r) => r.status !== 'CLOSED').sort(byDate)
  const closed = session.rents
    .filter((r) => r.status === 'CLOSED')
    .sort(byDate)
    .reverse()
  const concealed = session.profiles.filter((p) => p.concealed)

  return (
    <div className="flex h-full flex-col bg-card">
      <header className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-title font-semibold text-fg">Ваші оренди</h1>
          <span className="text-label tabular-nums text-muted-fg">
            {session.phoneMasked}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="ml-auto shrink-0 text-label text-muted-fg underline underline-offset-2 hover:text-fg"
          >
            Вийти
          </button>
        </div>
      </header>

      <main className="scroll-fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {open.length === 0 && closed.length === 0 ? (
          <EmptyState phone={managerPhone} />
        ) : (
          <>
            {open.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {open.map((r) => (
                  <RentRow key={r.id} rent={r} onOpen={() => onOpen(r.id)} />
                ))}
              </ul>
            ) : (
              <NoActive phone={managerPhone} />
            )}

            {closed.length > 0 && (
              <>
                <GroupLabel>Закриті</GroupLabel>
                <ul className="flex flex-col divide-y divide-border">
                  {closed.map((r) => (
                    <RentRow key={r.id} rent={r} onOpen={() => onOpen(r.id)} />
                  ))}
                </ul>
              </>
            )}

            {concealed.map((p) => (
              <CompanyNote
                key={p.id}
                name={p.name}
                count={p.rentCount}
                phone={managerPhone}
              />
            ))}
          </>
        )}
      </main>
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-y border-border bg-muted px-4 py-1.5 text-label font-medium uppercase tracking-wide text-muted-fg">
      {children}
    </h2>
  )
}

const CHIP: Record<
  RentSummary['status'],
  { label: string; className: string }
> = {
  ACTIVE: { label: 'В оренді', className: 'bg-success-soft text-success-fg' },
  EXPIRING_SOON: {
    label: 'Спливає строк',
    className: 'bg-notice-soft text-notice-fg',
  },
  OVERDUE: { label: 'Прострочено', className: 'bg-danger-soft text-danger-fg' },
  CLOSED: { label: 'Закрито', className: 'bg-muted text-muted-fg' },
}

function RentRow({
  rent,
  onOpen,
}: {
  rent: RentSummary
  onOpen: () => void
}) {
  const chip = CHIP[rent.status]
  const left = daysBetween(new Date().toISOString(), rent.plannedReturnAt)
  const closed = rent.status === 'CLOSED'
  const term = closed
    ? `Повернено ${dateTime(rent.plannedReturnAt)}`
    : left < 0
      ? `Прострочено ${Math.abs(left)} ${daysWord(Math.abs(left))}`
      : left === 0
        ? 'Повернення сьогодні'
        : `Залишилось ${left} ${daysWord(left)}`
  const extra = rent.itemsCount - 1

  return (
    <li>
      <button
        type="button"
        data-testid="pr-rent-row"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-body tabular-nums text-fg">
              {rent.rentCode}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-label font-medium ${chip.className}`}
            >
              {chip.label}
            </span>
          </span>
          {/* Позиция обрезается многоточием: длинные названия вроде
              «Віброплита реверсивна Wacker Neuson DPU 3050…» иначе выдавливают
              из строки дату и сумму. */}
          <span className="mt-1 block truncate text-body text-fg-2">
            {rent.leadItem}
            {extra > 0 && (
              <span className="text-muted-fg"> та ще {extra}</span>
            )}
          </span>
          <span className="mt-0.5 flex items-baseline gap-2 text-label text-muted-fg">
            <span
              className={`tabular-nums ${rent.status === 'OVERDUE' ? 'text-danger-fg' : ''}`}
            >
              {term}
            </span>
            <span aria-hidden>—</span>
            <span className="truncate">{rent.branchName}</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          {rent.due > 0 && (
            <span className="block text-body font-medium tabular-nums text-danger-fg">
              {money(rent.due)}
            </span>
          )}
          <span className="block text-label text-muted-fg">
            {rent.due > 0 ? 'до сплати' : closed ? '' : 'сплачено'}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
      </button>
    </li>
  )
}

/**
 * Аренды компании на личном номере: клиент видит, что они есть, но не их
 * состав и суммы. Показать их целиком — раскрыть корпоративные цифры тому,
 * кто держит телефон директора. ПРЕДЛОЖЕНИЕ, не решение бизнеса.
 */
function CompanyNote({
  name,
  count,
  phone,
}: {
  name: string
  count: number
  phone: string
}) {
  return (
    <section className="m-4 rounded-lg border border-border bg-muted p-4">
      <p className="flex items-center gap-2 text-body font-medium text-fg">
        <Building2 className="size-4 shrink-0 text-muted-fg" aria-hidden />
        {name}
      </p>
      <p className="mt-1.5 text-body text-muted-fg">
        На цей номер оформлено ще {count} {plural(count)} компанії. Продовжує їх
        менеджер — суми й обладнання тут не показуємо.
      </p>
      <CallButton phone={phone} />
    </section>
  )
}

function plural(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'оренду'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'оренди'
  return 'оренд'
}

function NoActive({ phone }: { phone: string }) {
  return (
    <section className="m-4 rounded-lg border border-border bg-muted p-4">
      <p className="flex items-center gap-2 text-body font-medium text-fg">
        <Info className="size-4 shrink-0 text-muted-fg" aria-hidden />
        Активних оренд немає
      </p>
      <p className="mt-1.5 text-body text-muted-fg">
        Нижче — те, що ви вже здали. Щоб узяти обладнання, зателефонуйте
        менеджеру.
      </p>
      <CallButton phone={phone} />
    </section>
  )
}

function EmptyState({ phone }: { phone: string }) {
  return (
    <section className="px-6 pb-8 pt-10">
      <p className="text-[22px] font-semibold leading-tight text-fg">
        Оренд на цьому номері немає
      </p>
      <p className="mt-2 text-body text-muted-fg">
        Можливо, оренду оформлено на інший номер. Менеджер підкаже за хвилину.
      </p>
      <CallButton phone={phone} />
    </section>
  )
}

function CallButton({ phone }: { phone: string }) {
  return (
    <a
      href={`tel:${phone.replace(/\D/g, '')}`}
      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-body font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1"
    >
      <Phone className="size-4" aria-hidden />
      Зателефонувати менеджеру
    </a>
  )
}
