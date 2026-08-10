import { useMemo } from 'react'
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CreditCard,
  Loader2,
  Lock,
  Phone,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { daysWord, money, shortDate, weekday } from './format'
import type { ExtendDay, PayMethod, PayMode, PublicRent } from './api'

/**
 * Консоль — единственное место действий на странице. Она не уезжает со
 * скроллом и меняет не экран, а собственное содержимое: продлить → выбрать
 * дату → оплатить → статус. Клиент на объекте держит телефон одной рукой:
 * палец не должен путешествовать по экрану, а сумма обязана стоять рядом с
 * кнопкой, которая её подтверждает.
 *
 * Способы оплаты идут от самого дешёвого для бизнеса к самому дорогому, и
 * первые два вообще не берут денег сейчас: залог и баланс уже у нас. Развилка
 * A/Б меняет ровно третью строку и то, что происходит после неё, — остальная
 * консоль общая.
 */
export type ConsoleMode =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'unavailable' }
  | { kind: 'paying' }
  /** Реквизиты на экране, клиент ушёл в банк и ещё не вернулся. */
  | { kind: 'invoice' }
  /** Менеджер поменял аренду, пока клиент выбирал дату. */
  | { kind: 'stale' }
  | { kind: 'failed'; message: string }

export function Console({
  rent,
  mode,
  payMode,
  candidateIso,
  method,
  pending,
  onOpenPicker,
  onCancel,
  onPick,
  onConfirmExtend,
  onPickMethod,
  onConfirmMethod,
  onDeclarePaid,
  onReload,
}: {
  rent: PublicRent
  mode: ConsoleMode
  payMode: PayMode
  candidateIso: string | null
  method: PayMethod | null
  pending: boolean
  onOpenPicker: () => void
  onCancel: () => void
  onPick: (iso: string) => void
  onConfirmExtend: () => void
  onPickMethod: (m: PayMethod) => void
  onConfirmMethod: () => void
  onDeclarePaid: () => void
  onReload: () => void
}) {
  const status = rent.topup?.status ?? 'NONE'

  // Порядок важен: выбор способа оплаты — намеренный шаг клиента и должен
  // перебивать статус счёта. Иначе «Доплатити» при недоплате возвращает тот
  // же экран недоплаты, и остаток заплатить нечем.
  const body = rent.readOnly ? (
    <ReadOnlyConsole reason={rent.readOnly.reason} phone={rent.branch.phone} />
  ) : mode.kind === 'stale' ? (
    <StaleConsole onReload={onReload} />
  ) : mode.kind === 'failed' ? (
    <FailedConsole message={mode.message} onRetry={onReload} />
  ) : mode.kind === 'paying' && rent.topup ? (
    <PayingConsole
      rent={rent}
      payMode={payMode}
      method={method}
      pending={pending}
      onPickMethod={onPickMethod}
      onConfirm={onConfirmMethod}
      onLater={onCancel}
    />
  ) : mode.kind === 'invoice' ? (
    <InvoiceConsole
      rent={rent}
      pending={pending}
      onDeclare={onDeclarePaid}
      onLater={onCancel}
    />
  ) : status === 'AWAITING' ? (
    <AwaitingConsole rent={rent} />
  ) : status === 'PARTIAL' ? (
    <PartialConsole rent={rent} onPayRest={onOpenPicker} />
  ) : status === 'PAID' || status === 'DEPOSIT_OFFSET' ? (
    <SettledConsole rent={rent} />
  ) : mode.kind === 'unavailable' ? (
    <UnavailableConsole onCancel={onCancel} />
  ) : rent.topup && status === 'NONE' ? (
    <PendingTopupConsole rent={rent} onPay={onOpenPicker} />
  ) : mode.kind === 'picking' && rent.extend ? (
    <PickingConsole
      rent={rent}
      days={rent.extend.days}
      candidateIso={candidateIso}
      pending={pending}
      onPick={onPick}
      onCancel={onCancel}
      onConfirm={onConfirmExtend}
    />
  ) : (
    <IdleConsole rent={rent} onOpen={onOpenPicker} />
  )

  return (
    <div className="shrink-0 border-t border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
      <div
        key={mode.kind + status}
        className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 motion-safe:ease-out"
      >
        {body}
      </div>
    </div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  pending,
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  pending?: boolean
  type?: 'button' | 'submit'
}) {
  // Выключенная кнопка — muted-заливка с subtle-текстом и сохранённой рамкой,
  // а не полупрозрачная чёрная плита: на пол-экрана она читалась как
  // сломанная, а не как «пока нечего подтверждать».
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-fg bg-fg text-title font-medium text-primary-fg transition-colors hover:bg-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1 disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-subtle"
    >
      {pending && (
        <Loader2
          className="size-4 animate-spin motion-reduce:hidden"
          aria-hidden
        />
      )}
      {children}
    </button>
  )
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-title font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1"
    >
      {children}
    </button>
  )
}

function IdleConsole({ rent, onOpen }: { rent: PublicRent; onOpen: () => void }) {
  const due = Math.max(0, rent.rentAccount.accrued - rent.rentAccount.paid)
  return (
    <div className="flex flex-col gap-3">
      {due > 0 && (
        <p className="text-body text-danger-fg">
          Борг за простроченими добами — {money(due)}. Він увійде в суму
          доплати.
        </p>
      )}
      <PrimaryButton onClick={onOpen}>
        <CalendarClock className="size-4" aria-hidden />
        Продовжити оренду
      </PrimaryButton>
      <p className="text-center text-label text-muted-fg">
        Тут можна продовжити на строк до 7 діб
      </p>
    </div>
  )
}

/** Ряд суток — это и есть календарь: в нём физически нет запрещённых дат. */
function PickingConsole({
  rent,
  days,
  candidateIso,
  pending,
  onPick,
  onCancel,
  onConfirm,
}: {
  rent: PublicRent
  days: ExtendDay[]
  candidateIso: string | null
  pending: boolean
  onPick: (iso: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const fullRate = rent.items.reduce((s, it) => s + it.dayRate * it.qty, 0)
  const span = useMemo(() => {
    const idx = days.findIndex((d) => d.iso === candidateIso)
    return idx < 0 ? [] : days.slice(0, idx + 1)
  }, [days, candidateIso])

  const gross = span.length * fullRate
  const adjustments = span
    .filter((d) => d.coefficient)
    .map((d) => ({
      label: `${d.coefficient!.label} × ${d.coefficient!.factor.toLocaleString('uk-UA')}`,
      delta: d.amount - fullRate,
    }))
  const net = span.reduce((s, d) => s + d.amount, 0)
  const total = net + rent.debt
  const blocked = span.some((d) => !d.available)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="text-label font-medium uppercase tracking-wide text-muted-fg">
          До якого числа
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-body text-muted-fg underline underline-offset-2 hover:text-fg"
        >
          Скасувати
        </button>
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <DayCell
          iso={rent.plannedReturnAt}
          caption="зараз"
          disabled
          selected={false}
          onPick={() => {}}
        />
        {days.map((d, i) => (
          <DayCell
            key={d.iso}
            testId={`pr-day-${i}`}
            iso={`${d.iso}T10:00:00`}
            price={d.amount}
            unavailable={!d.available}
            selected={d.iso === candidateIso}
            onPick={() => onPick(d.iso)}
          />
        ))}
      </div>

      {span.length > 0 && (
        <div className="rounded-md bg-muted p-3">
          <Line
            label={`${span.length} ${daysWord(span.length)} × ${money(fullRate)}`}
            value={money(gross)}
          />
          {adjustments.map((a) => (
            <Line key={a.label} label={a.label} value={money(a.delta)} muted />
          ))}
          {rent.debt > 0 && (
            <Line label="Борг за прострочку" value={money(rent.debt)} danger />
          )}
          <div className="my-1.5 h-px bg-border" />
          {/* «Доплата», не «До сплати»: в записи над консолью уже стоит «До
              сплати» по счёту аренды, и две разные суммы под одной подписью в
              одном экране — прямой путь к звонку менеджеру. */}
          <div className="flex items-baseline justify-between">
            <span className="text-body font-medium text-fg">Доплата</span>
            <span className="text-[22px] font-semibold tabular-nums leading-none text-fg">
              {money(total)}
            </span>
          </div>
        </div>
      )}

      <PrimaryButton
        onClick={onConfirm}
        disabled={span.length === 0}
        pending={pending}
      >
        {span.length === 0
          ? 'Оберіть дату повернення'
          : `Продовжити до ${shortDate(`${candidateIso}T10:00:00`)}`}
        {span.length > 0 && !pending && (
          <ArrowRight className="size-4" aria-hidden />
        )}
      </PrimaryButton>
      <p className="text-center text-label text-muted-fg">
        {blocked
          ? 'На частину обраних діб обладнання зайняте — заявку прийме менеджер'
          : 'Мінімум +1 доба, максимум +7 діб'}
      </p>
    </div>
  )
}

function DayCell({
  iso,
  price,
  caption,
  selected,
  disabled = false,
  unavailable = false,
  testId,
  onPick,
}: {
  iso: string
  price?: number
  caption?: string
  selected: boolean
  disabled?: boolean
  unavailable?: boolean
  testId?: string
  onPick: () => void
}) {
  const off = disabled || unavailable
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex h-[70px] w-[62px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1 ${
        selected
          ? 'border-fg bg-fg text-primary-fg'
          : off
            ? 'border-border bg-muted text-subtle'
            : 'border-border-strong bg-card text-fg hover:bg-muted'
      }`}
    >
      {/* День недели нейтральным: красный здесь читался бы как ошибка, а
          цвет на этой странице всегда означает состояние, не оформление. */}
      <span
        className={`text-label ${selected ? 'text-primary-fg/70' : 'text-muted-fg'}`}
      >
        {caption ?? weekday(iso)}
      </span>
      <span className="text-title font-semibold tabular-nums leading-none">
        {shortDate(iso).slice(0, 2)}
      </span>
      {unavailable ? (
        <Lock className="size-3" aria-label="зайнято" />
      ) : (
        <span
          className={`text-label tabular-nums ${selected ? 'text-primary-fg/70' : 'text-muted-fg'}`}
        >
          {price != null ? price.toLocaleString('uk-UA') : '—'}
        </span>
      )}
    </button>
  )
}

function Line({
  label,
  value,
  muted = false,
  danger = false,
}: {
  label: string
  value: string
  muted?: boolean
  danger?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span
        className={`text-body ${danger ? 'text-danger-fg' : muted ? 'text-muted-fg' : 'text-fg-2'}`}
      >
        {label}
      </span>
      <span
        className={`shrink-0 text-body tabular-nums ${danger ? 'text-danger-fg' : muted ? 'text-muted-fg' : 'text-fg'}`}
      >
        {value}
      </span>
    </div>
  )
}

function UnavailableConsole({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Подробности — в карточке заявки наверху записи; здесь только итог,
          иначе один и тот же абзац стоит на экране дважды. */}
      <p className="text-title font-medium text-fg">Заявку прийнято</p>
      <PrimaryButton onClick={onCancel}>Зрозуміло</PrimaryButton>
    </div>
  )
}

/**
 * Способы оплаты. Порядок — по цене для бизнеса: залог и баланс уже у нас и
 * не стоят ничего, перевод стоит нуля и неудобен клиенту, карта удобна и
 * стоит комиссии. Развилка меняет ровно последнюю строку.
 */
function PayingConsole({
  rent,
  payMode,
  method,
  pending,
  onPickMethod,
  onConfirm,
  onLater,
}: {
  rent: PublicRent
  payMode: PayMode
  method: PayMethod | null
  pending: boolean
  onPickMethod: (m: PayMethod) => void
  onConfirm: () => void
  onLater: () => void
}) {
  const topup = rent.topup!
  const outstanding = topup.amount - topup.paid
  const balance = rent.counterparty.balance
  const depositHeld = rent.depositAccount.paid
  const depositCovers = depositHeld >= outstanding

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-label font-medium uppercase tracking-wide text-muted-fg">
          Як сплатити
        </p>
        {/* Сумма подписана «доплата» прямо здесь: выше в записи стоит «До
            сплати» по счёту аренды, и два разных числа под похожими подписями
            на одном экране — прямой путь к звонку менеджеру. */}
        <span className="shrink-0 text-body text-muted-fg">
          доплата{' '}
          <span className="text-title font-semibold tabular-nums text-fg">
            {money(outstanding)}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Ничего не платить сейчас — самый дешёвый исход и для клиента, и для
            нас: механика зачёта из залога уже описана и работает сегодня.
            Поэтому строка стоит первой. */}
        {depositHeld > 0 && (
          <MethodRow
            value="DEPOSIT_OFFSET"
            icon={<ShieldCheck className="size-4" aria-hidden />}
            label="Утримати із застави"
            hint={
              depositCovers
                ? `Із ${money(depositHeld)} застави. Платити зараз не потрібно`
                : `У заставі ${money(depositHeld)} — не вистачає ${money(outstanding - depositHeld)}`
            }
            selected={method === 'DEPOSIT_OFFSET'}
            disabled={!depositCovers}
            onSelect={() => onPickMethod('DEPOSIT_OFFSET')}
          />
        )}
        {/* Баланс закрывает доплату ЦЕЛИКОМ или не участвует: смешанной оплаты
            (часть балансом, остаток переводом) в спеке нет, и списать 1 200 с
            остатка в 500 — выдуманные деньги. Не хватает → способ виден с
            названной нехваткой, но выключен. */}
        {balance > 0 && (
          <MethodRow
            value="BALANCE"
            icon={<Wallet className="size-4" aria-hidden />}
            label="Сплатити з рахунку"
            hint={
              balance >= outstanding
                ? `На вашому рахунку ${money(balance)}`
                : `На рахунку ${money(balance)} — не вистачає ${money(outstanding - balance)}`
            }
            selected={method === 'BALANCE'}
            disabled={balance < outstanding}
            onSelect={() => onPickMethod('BALANCE')}
          />
        )}

        {payMode === 'BANKS' ? (
          <MethodRow
            value="BANK"
            icon={<Building2 className="size-4" aria-hidden />}
            label="Переказ за реквізитами"
            hint="Покажемо рахунок — сплатите у своєму банку"
            selected={method === 'BANK'}
            onSelect={() => onPickMethod('BANK')}
          />
        ) : (
          <MethodRow
            value="CARD"
            icon={<CreditCard className="size-4" aria-hidden />}
            label="Карткою онлайн"
            hint="Apple Pay, Google Pay або номер картки"
            selected={method === 'CARD'}
            onSelect={() => onPickMethod('CARD')}
          />
        )}
      </div>

      <PrimaryButton
        onClick={onConfirm}
        disabled={method == null}
        pending={pending}
      >
        {method === 'BANK'
          ? 'Показати реквізити'
          : method === 'CARD'
            ? `Сплатити ${money(outstanding)}`
            : method === 'DEPOSIT_OFFSET'
              ? 'Так, утримати із застави'
              : method === 'BALANCE'
                ? `Списати ${money(outstanding)}`
                : 'Оберіть спосіб оплати'}
      </PrimaryButton>
      <div className="flex flex-col items-center gap-2">
        {/* Выход из оплаты. Без него единственная дорога назад — стрелка в
            шапке, а на одиночной аренде её нет вовсе: клиент, решивший
            заплатить вечером, оказывался заперт на экране способов. */}
        <button
          type="button"
          onClick={onLater}
          className="text-body text-muted-fg underline underline-offset-2 hover:text-fg"
        >
          Сплачу пізніше
        </button>
        <p className="text-center text-label text-muted-fg">
          Готівкою — на відділенні, коли повертатимете обладнання
        </p>
      </div>
    </div>
  )
}

/**
 * Продление сделано, счёт выставлен, клиент ушёл и вернулся. Без этого экрана
 * консоль предлагала «Продовжити оренду» поверх уже сделанного продления.
 */
function PendingTopupConsole({
  rent,
  onPay,
}: {
  rent: PublicRent
  onPay: () => void
}) {
  const topup = rent.topup!
  const left = topup.amount - topup.paid
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-fg">
        Оренду продовжено до {shortDate(rent.plannedReturnAt)}. Залишилось
        сплатити доплату.
      </p>
      <PrimaryButton onClick={onPay}>Сплатити {money(left)}</PrimaryButton>
    </div>
  )
}

function MethodRow({
  value,
  icon,
  label,
  hint,
  selected,
  disabled = false,
  onSelect,
}: {
  value: PayMethod
  icon: React.ReactNode
  label: string
  hint: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`pr-method-${value}`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex min-h-[52px] items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1 ${
        disabled
          ? 'cursor-default border-border bg-muted text-subtle'
          : selected
            ? 'border-accent bg-accent-soft text-accent-fg'
            : 'border-border bg-card text-fg hover:bg-muted'
      }`}
    >
      <span
        className={
          disabled ? 'text-subtle' : selected ? 'text-accent-fg' : 'text-muted-fg'
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{label}</span>
        <span
          className={`block text-label ${disabled ? 'text-subtle' : selected ? 'text-accent-fg' : 'text-muted-fg'}`}
        >
          {hint}
        </span>
      </span>
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-accent bg-accent text-white' : 'border-border-strong'} ${disabled ? 'opacity-40' : ''}`}
      >
        {selected && <Check className="size-3" aria-hidden />}
      </span>
    </button>
  )
}

/**
 * Реквизиты уже на экране (карточка счёта в записи выше). Здесь — только
 * кнопка, которой клиент говорит «я перевёл». Она не «оплачено»: деньги
 * подтверждает не она, а зачисление.
 */
function InvoiceConsole({
  rent,
  pending,
  onDeclare,
  onLater,
}: {
  rent: PublicRent
  pending: boolean
  onDeclare: () => void
  onLater: () => void
}) {
  const topup = rent.topup!
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-fg">
        Реквізити вище. Скопіюйте призначення платежу — без нього ми не
        побачимо, за яку оренду гроші.
      </p>
      {/* «Оплату виконано», а не «Я сплатив»: клієнтка не має читати про себе
          в чоловічому роді на екрані, де вона віддає гроші. */}
      <PrimaryButton onClick={onDeclare} pending={pending}>
        Оплату виконано — {money(topup.amount - topup.paid)}
      </PrimaryButton>
      <button
        type="button"
        onClick={onLater}
        className="text-center text-body text-muted-fg underline underline-offset-2 hover:text-fg"
      >
        Сплачу пізніше
      </button>
    </div>
  )
}

function AwaitingConsole({ rent }: { rent: PublicRent }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Loader2
          className="size-4 animate-spin text-muted-fg motion-reduce:hidden"
          aria-hidden
        />
        <p className="text-title font-medium text-fg">Чекаємо на гроші</p>
      </div>
      <p className="text-body text-muted-fg">
        Оренду вже продовжено — обладнання ваше. Коли платіж дійде, цей рядок
        зміниться сам. Зазвичай це кілька годин, у вихідні — до наступного
        робочого дня.
      </p>
      <p className="text-label tabular-nums text-subtle">
        Рахунок {rent.topup?.invoiceNo} — {money(rent.topup?.amount ?? 0)}
      </p>
    </div>
  )
}

/**
 * Недоплата. Самый острый кейс: клиент нажал «сплатив», перевёл меньше, и в
 * старой модели страница висела в ожидании навсегда. Счёт остаётся живым,
 * остаток назван, кнопка возвращается.
 */
function PartialConsole({
  rent,
  onPayRest,
}: {
  rent: PublicRent
  onPayRest: () => void
}) {
  const topup = rent.topup!
  const left = topup.amount - topup.paid
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md bg-muted p-3">
        <Line label="Зараховано" value={money(topup.paid)} muted />
        <Line label={`Рахунок ${topup.invoiceNo}`} value={money(topup.amount)} muted />
        <div className="my-1.5 h-px bg-border" />
        <div className="flex items-baseline justify-between">
          <span className="text-body font-medium text-fg">Залишилось</span>
          <span className="text-[22px] font-semibold tabular-nums leading-none text-danger-fg">
            {money(left)}
          </span>
        </div>
      </div>
      <PrimaryButton onClick={onPayRest}>Доплатити {money(left)}</PrimaryButton>
      <p className="text-center text-label text-muted-fg">
        Оренду продовжено — строк не зміниться, поки ви доплачуєте
      </p>
    </div>
  )
}

function SettledConsole({ rent }: { rent: PublicRent }) {
  const offset = rent.topup?.status === 'DEPOSIT_OFFSET'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className={`grid size-5 place-items-center rounded-full ${offset ? 'bg-notice' : 'bg-success'} text-white`}
        >
          <Check className="size-3" aria-hidden />
        </span>
        <p className="text-title font-medium text-fg">
          {offset ? 'Продовжено — платити зараз не треба' : 'Гроші отримали'}
        </p>
      </div>
      <p className="text-body text-muted-fg">
        {offset
          ? `Доплату ${money(rent.topup?.amount ?? 0)} утримаємо із застави, коли приймемо обладнання. Решту застави повернемо.`
          : `Оренда діє до ${shortDate(rent.plannedReturnAt)}. Гарної роботи.`}
      </p>
    </div>
  )
}

/**
 * Менеджер поменял аренду, пока клиент выбирал дату. Продлевать поверх чужой
 * правки нельзя: клиент оплатит срок, которого уже нет.
 */
function StaleConsole({ onReload }: { onReload: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-title font-medium text-fg">Оренда змінилася</p>
      <p className="text-body text-muted-fg">
        Менеджер щойно оновив цю оренду. Подивіться нові дані й оберіть дату
        ще раз.
      </p>
      <SecondaryButton onClick={onReload}>
        <RefreshCw className="size-4" aria-hidden />
        Оновити
      </SecondaryButton>
    </div>
  )
}

/**
 * Упавший запрос. Без этого экрана неудачное продление оставляло консоль в
 * выборе даты без единого слова — клиент жал кнопку ещё раз и ещё раз.
 */
function FailedConsole({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-body text-danger-fg">
        {message}
      </p>
      <SecondaryButton onClick={onRetry}>
        <RefreshCw className="size-4" aria-hidden />
        Спробувати ще раз
      </SecondaryButton>
    </div>
  )
}

function ReadOnlyConsole({ reason, phone }: { reason: string; phone: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-fg">{reason}</p>
      <a
        href={`tel:${phone.replace(/\D/g, '')}`}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-title font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1"
      >
        <Phone className="size-4" aria-hidden />
        Зателефонувати менеджеру
      </a>
    </div>
  )
}
