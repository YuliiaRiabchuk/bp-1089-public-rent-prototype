import {
  Check,
  Copy,
  Download,
  Mail,
  MapPin,
  Phone,
  Printer,
  Send,
} from 'lucide-react'
import { useState } from 'react'
import {
  dateTime,
  daysBetween,
  daysWord,
  money,
  shortDate,
} from './format'
import type { PublicRent } from './api'

/**
 * Запись аренды — средний, скроллящийся слой страницы. Здесь ничего не
 * нажимается ради денег: все действия живут в консоли внизу. Отсюда клиент
 * только читает, что у него на руках и сколько это стоит.
 *
 * Один лист, а не стопка карточек: разделы держат тонкие линейки и
 * muted-полосы группы — тот же приём, что в каталоге основной системы.
 * Карточка остаётся ровно за двумя блоками, которые ИСКЛЮЧЕНИЕ из чтения:
 * заявка менеджеру и счёт.
 *
 * Аренда и залог стоят двумя группами и не суммируются нигде — это два
 * независимых счёта, и строки «Разом» на странице нет.
 */
export function RentRecord({
  rent,
  candidateIso,
  onSend,
}: {
  rent: PublicRent
  /** Дата, которую клиент сейчас перебирает в консоли, — хвост на шкале. */
  candidateIso: string | null
  /** Повторная отправка готового счёта. Только у юрлица. */
  onSend: (channel: 'EMAIL' | 'MESSENGER') => Promise<string>
}) {
  return (
    <div className="bg-card pb-4">
      {/* Заявка менеджеру стоит ПЕРВОЙ: это ответ на действие, которое клиент
          только что сделал, и он не должен искать его прокруткой. */}
      {rent.managerTask && rent.topup == null && (
        <ManagerTaskCard code={rent.managerTask.code} />
      )}

      {/* Срок открывает лист без полосы группы: это утверждение страницы, а не
          один из её разделов. */}
      <TermBlock rent={rent} candidateIso={candidateIso} />

      <GroupLabel>Обладнання</GroupLabel>
      <ItemsBlock rent={rent} />

      <GroupLabel>Рахунок оренди</GroupLabel>
      <RentAccountBlock rent={rent} />

      <GroupLabel>Застава</GroupLabel>
      <DepositBlock rent={rent} />

      {/* Счёт показывается там, где по нему платят: физлицу — при переводе по
          реквизитам, юрлицу — всегда, но только когда документ уже собран. */}
      {(rent.topup?.method === 'BANK' ||
        (rent.topup?.method === 'INVOICE' && rent.topup.ready)) && (
        <InvoiceCard rent={rent} onSend={onSend} />
      )}

      <GroupLabel>Повернення на склад</GroupLabel>
      <BranchBlock rent={rent} />
    </div>
  )
}

/** Полоса группы — muted, во всю ширину, прямые углы. Каталожная. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-y border-border bg-muted px-4 py-1.5 text-label font-medium uppercase tracking-wide text-muted-fg">
      {children}
    </h2>
  )
}

/** Строка «подпись — сумма». Суммы всегда tabular, иначе колонка дрожит. */
function Row({
  label,
  value,
  tone = 'default',
  strong = false,
}: {
  label: React.ReactNode
  value: React.ReactNode
  tone?: 'default' | 'muted' | 'danger'
  strong?: boolean
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-danger-fg'
      : tone === 'muted'
        ? 'text-muted-fg'
        : 'text-fg'
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span
        className={`text-body ${tone === 'muted' ? 'text-muted-fg' : 'text-fg-2'}`}
      >
        {label}
      </span>
      <span
        className={`shrink-0 tabular-nums ${strong ? 'text-title font-semibold' : 'text-body'} ${toneClass}`}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Шкала срока: одна ячейка — одни сутки. Прожитое, оставшееся, просрочка и
 * выбранное продление читаются одним взглядом, без чтения дат.
 */
function TermBlock({
  rent,
  candidateIso,
}: {
  rent: PublicRent
  candidateIso: string | null
}) {
  const closed = rent.status === 'CLOSED'
  const nowIso = new Date().toISOString()
  const total = Math.max(1, daysBetween(rent.issuedAt, rent.plannedReturnAt))
  // У закрытой аренды срок кончился по плану, а не «просрочен»: она уже сдана,
  // и красный хвост на шкале обвинял бы клиента в том, чего не было.
  const spent = closed
    ? total
    : Math.min(total, Math.max(0, daysBetween(rent.issuedAt, nowIso)))
  const left = daysBetween(nowIso, rent.plannedReturnAt)
  const overdue = !closed && left < 0 ? Math.abs(left) : 0
  // Хвост = ровно те сутки, которые попадут в счёт, то есть длина выбранного
  // отрезка в ряду продления. Считать его от планового возврата нельзя: на
  // просроченной аренде просроченные сутки уже стоят на шкале красным, и
  // отсчёт от плана рисовал бы их второй раз янтарным.
  const added =
    candidateIso && rent.extend
      ? rent.extend.days.findIndex((d) => d.iso === candidateIso) + 1
      : 0

  const cells: Array<'spent' | 'left' | 'overdue' | 'added'> = [
    ...Array<'spent'>(spent).fill('spent'),
    ...Array<'left'>(Math.max(0, total - spent)).fill('left'),
    ...Array<'overdue'>(overdue).fill('overdue'),
    ...Array<'added'>(added).fill('added'),
  ]
  const cellTone = {
    spent: 'bg-fg-2',
    left: 'bg-border-strong',
    overdue: 'bg-danger',
    added: 'bg-notice',
  }

  return (
    <section className="px-4 pb-4 pt-4">
      <p
        className={`text-[22px] font-semibold leading-none tracking-tight ${overdue ? 'text-danger-fg' : 'text-fg'}`}
      >
        {closed
          ? 'Оренду закрито'
          : overdue
            ? `Прострочено ${overdue} ${daysWord(overdue)}`
            : left === 0
              ? 'Повернення сьогодні'
              : `Залишилось ${left} ${daysWord(left)}`}
      </p>

      <div className="mt-3 flex items-end gap-[2px]" aria-hidden>
        {cells.map((tone, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-[2px] ${cellTone[tone]} ${tone === 'added' ? 'motion-safe:animate-value-pulse' : ''}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-label text-muted-fg">
        <span className="tabular-nums">Видано {shortDate(rent.issuedAt)}</span>
        <span className="tabular-nums">
          {added > 0 ? (
            <>
              <s className="text-subtle">{shortDate(rent.plannedReturnAt)}</s>{' '}
              <span className="font-medium text-notice-fg">
                {candidateIso ? shortDate(`${candidateIso}T10:00:00`) : ''}
              </span>
            </>
          ) : (
            `Повернення ${dateTime(rent.plannedReturnAt)}`
          )}
        </span>
      </div>
    </section>
  )
}

function ItemsBlock({ rent }: { rent: PublicRent }) {
  return (
    <ul className="flex flex-col divide-y divide-border px-4">
      {rent.items.map((it) => (
        <li
          key={it.id}
          className="flex items-baseline justify-between gap-3 py-2.5"
        >
          {/* `min-w-0` обязателен: без него длинное название вроде «Віброплита
              реверсивна Wacker Neuson DPU 3050 з подовженим тримачем» не
              переносится, а выдавливает цену за край экрана. */}
          <span className="min-w-0 flex-1 text-body text-fg">{it.name}</span>
          <span className="shrink-0 text-right">
            <span className="block text-body tabular-nums text-fg">
              ×{it.qty}
            </span>
            <span className="block text-label tabular-nums text-muted-fg">
              {money(it.dayRate)}/доба
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function RentAccountBlock({ rent }: { rent: PublicRent }) {
  const due = Math.max(0, rent.rentAccount.accrued - rent.rentAccount.paid)
  // НДС выделяется из начисленного, а не добавляется к нему: ставка юрлица
  // уже с НДС, и клиент сверяет именно эту долю со своим счётом.
  const vat = rent.legal
    ? Math.round(
        rent.rentAccount.accrued *
          (rent.legal.vatRate / (1 + rent.legal.vatRate)),
      )
    : 0
  return (
    <div className="px-4 py-2.5">
      <Row
        label={`${rent.rentAccount.days} ${daysWord(rent.rentAccount.days)} — нараховано`}
        value={money(rent.rentAccount.accrued)}
      />
      {rent.legal && (
        <Row label="у т.ч. ПДВ 20 %" value={money(vat)} tone="muted" />
      )}
      <Row label="Сплачено" value={money(rent.rentAccount.paid)} tone="muted" />
      <div className="my-1 h-px bg-border" />
      <Row
        label="До сплати"
        value={money(due)}
        tone={due > 0 ? 'danger' : 'default'}
        strong
      />
    </div>
  )
}

/**
 * Залог отдельной группой с явной оговоркой. Единственная защита от вопроса
 * «а чому в мене 7 800» — не показывать сумму, которой не существует.
 */
function DepositBlock({ rent }: { rent: PublicRent }) {
  // У закрытой аренды нулевой `paid` означает «залог уже вернули», а не «клиент
  // не внёс»: без этой ветки страница требовала бы денег по сданной аренде.
  const closed = rent.status === 'CLOSED'
  const held = rent.depositAccount.paid >= rent.depositAccount.amount
  return (
    <div className="px-4 py-2.5">
      <Row
        label={
          closed
            ? 'Повернено після приймання'
            : held
              ? 'Внесено — заморожено до приймання'
              : 'До внесення'
        }
        value={money(rent.depositAccount.amount)}
        tone={closed ? 'muted' : 'default'}
        strong
      />
      {!closed && (
        <p className="mt-1.5 text-label leading-relaxed text-muted-fg">
          Застава не входить у вартість оренди й повертається після приймання
          обладнання.
        </p>
      )}
    </div>
  )
}

/**
 * Счёт за продление — отдельный документ; выставленный не корректируется.
 * Единственный блок записи, который остаётся карточкой: он и есть документ,
 * его печатают и по нему платят.
 */
function InvoiceCard({
  rent,
  onSend,
}: {
  rent: PublicRent
  onSend: (channel: 'EMAIL' | 'MESSENGER') => Promise<string>
}) {
  const topup = rent.topup
  if (!topup) return null

  const legal = rent.legal
  // НДС сидит ВНУТРИ суммы, а не добавляется сверху: строка так и называется
  // «у т.ч. ПДВ». Считать её здесь честнее, чем нести в фикстуре: сумма счёта
  // складывается из выбранных суток, и доля обязана следовать за ней.
  const vat = legal
    ? Math.round(topup.amount * (legal.vatRate / (1 + legal.vatRate)))
    : 0
  // Счёт — не отдельная сделка, а продолжение действующей аренды на добавленные
  // сутки. Её номер стоит в назначении платежа: по нему бухгалтерия подшивает
  // счёт к своему договору, а наш платёж находит свою аренду, а не уходит в
  // «неопізнані».
  const purpose = legal
    ? `Продовження оренди ${rent.rentCode} на ${topup.days} ${daysWord(topup.days)}, рахунок ${topup.invoiceNo}, у т.ч. ПДВ 20%.`
    : `Продовження оренди ${rent.rentCode}, рахунок ${topup.invoiceNo}. Без ПДВ.`
  const payee = legal
    ? {
        name: legal.payeeName,
        edrpou: legal.payeeEdrpou,
        iban: legal.payeeIban,
      }
    : {
        name: rent.branch.fopName,
        edrpou: rent.branch.fopEdrpou,
        iban: rent.branch.fopIban,
      }
  const requisites = [
    `Отримувач: ${payee.name}`,
    `ЄДРПОУ: ${payee.edrpou}`,
    `IBAN: ${payee.iban}`,
    `Сума: ${money(topup.amount)}`,
    ...(legal ? [`у т.ч. ПДВ 20%: ${money(vat)}`] : []),
    `Призначення: ${purpose}`,
  ].join('\n')

  return (
    <section
      data-public-invoice
      className="mx-4 my-4 rounded-lg border border-border-strong bg-card p-4"
    >
      <h2 className="text-label font-medium uppercase tracking-wide text-muted-fg">
        Рахунок {topup.invoiceNo}
      </h2>
      <p className="mb-3 text-label text-muted-fg">
        Продовження оренди {rent.rentCode} на {topup.days}{' '}
        {daysWord(topup.days)} — ті самі позиції за чинними ставками
      </p>
      <Row label="Сума рахунку" value={money(topup.amount)} strong />
      {legal && <Row label="у т.ч. ПДВ 20 %" value={money(vat)} tone="muted" />}
      <div className="my-2 h-px bg-border" />
      <dl className="flex flex-col gap-2">
        <Field term="Отримувач" value={payee.name} />
        <Field term="ЄДРПОУ" value={payee.edrpou} mono />
        <Field term="IBAN" value={payee.iban} mono />
        <Field term="Призначення платежу" value={purpose} />
      </dl>
      {/* Назначение копируется ОТДЕЛЬНО и стоит первым. Одна кнопка на все
          пять строк давала блок, который в поле «призначення» банка не
          вставить, — а без назначения платёж не находит свою аренду и уходит
          в «неопізнані» к бухгалтеру. */}
      <div data-print-hide className="mt-4 flex flex-col gap-2">
        {legal ? (
          /* Юрлицо счёт не набирает в банке руками — его отдают бухгалтерии
             файлом. Поэтому первое действие здесь не «скопіювати», а
             «завантажити», и рядом — пересылка: бухгалтерия сидит не в том
             мессенджере, где директор открыл страницу. */
          <>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-fg bg-fg text-body font-medium text-primary-fg transition-colors hover:bg-fg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1"
            >
              <Download className="size-4" aria-hidden />
              Завантажити PDF
            </button>
            <SendButton
              label="Надіслати на пошту"
              icon={<Mail className="size-4" aria-hidden />}
              onSend={() => onSend('EMAIL')}
            />
            <SendButton
              label="Переслати в месенджер"
              icon={<Send className="size-4" aria-hidden />}
              onSend={() => onSend('MESSENGER')}
            />
            <CopyButton text={requisites} label="Скопіювати реквізити" />
          </>
        ) : (
          <>
            <CopyButton text={purpose} label="Скопіювати призначення" primary />
            <CopyButton text={payee.iban} label="Скопіювати IBAN" />
            <CopyButton text={requisites} label="Скопіювати все" />
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-card text-body font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1"
            >
              <Printer className="size-4" aria-hidden />
              Роздрукувати рахунок
            </button>
          </>
        )}
      </div>
      {legal && topup.sentTo && (
        <p data-print-hide className="mt-3 text-label text-muted-fg">
          Рахунок надіслано на {topup.sentTo}
        </p>
      )}
    </section>
  )
}

/**
 * Отправка называет адресата после успеха. «Надіслано» без адреса оставляет
 * клиента гадать, куда именно, — и он жмёт второй раз.
 */
function SendButton({
  label,
  icon,
  onSend,
}: {
  label: string
  icon: React.ReactNode
  onSend: () => Promise<string>
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>(
    'idle',
  )
  const [target, setTarget] = useState('')

  const run = async () => {
    setState('sending')
    try {
      setTarget(await onSend())
      setState('done')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 3200)
  }

  return (
    <>
      <button
        type="button"
        disabled={state === 'sending'}
        onClick={() => void run()}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-card text-body font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1 disabled:text-subtle"
      >
        {state === 'done' ? (
          <Check className="size-4 text-success-fg" aria-hidden />
        ) : (
          icon
        )}
        {state === 'done' ? `Надіслано — ${target}` : label}
      </button>
      {state === 'failed' && (
        <p role="alert" className="text-label text-danger-fg">
          Не вдалося надіслати. Спробуйте ще раз або завантажте PDF.
        </p>
      )}
    </>
  )
}

/**
 * Копирование молча падает без https и без разрешения — клиент жмёт, ничего
 * не происходит, и он жмёт ещё раз. Неудача обязана называть себя и выход:
 * реквизиты на экране, их можно выделить руками.
 */
function CopyButton({
  text,
  label,
  primary = false,
}: {
  text: string
  label: string
  primary?: boolean
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 2600)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1 ${
          primary
            ? 'border-fg bg-fg text-primary-fg hover:bg-fg-2'
            : 'border-border bg-card text-fg hover:bg-muted'
        }`}
      >
        {state === 'done' ? (
          <Check
            className={`size-4 ${primary ? '' : 'text-success-fg'}`}
            aria-hidden
          />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        {state === 'done' ? 'Скопійовано' : label}
      </button>
      {state === 'failed' && (
        <p role="alert" className="text-label text-danger-fg">
          Скопіювати не вдалося — виділіть текст вище вручну.
        </p>
      )}
    </>
  )
}

function Field({
  term,
  value,
  mono = false,
}: {
  term: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-label text-muted-fg">{term}</dt>
      <dd
        className={`text-body text-fg ${mono ? 'font-mono tabular-nums break-all' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}

function ManagerTaskCard({ code }: { code: string }) {
  return (
    <section className="mx-4 mt-4 rounded-lg border border-notice/50 bg-notice-soft p-4">
      <h2 className="mb-2 text-label font-medium uppercase tracking-wide text-notice-fg">
        Заявка менеджеру
      </h2>
      <p className="text-body text-fg-2">
        Обладнання на обрані дати зайняте, тому строк не змінено. Менеджер
        зв'яжеться з вами протягом години.
      </p>
      <p className="mt-2 text-label tabular-nums text-muted-fg">Заявка {code}</p>
    </section>
  )
}

function BranchBlock({ rent }: { rent: PublicRent }) {
  return (
    <div className="px-4 py-3">
      <p className="text-body font-medium text-fg">{rent.branch.name}</p>
      <p className="mt-1 flex items-start gap-2 text-body text-muted-fg">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
        {rent.branch.address}
      </p>
      <a
        href={`tel:${rent.branch.phone.replace(/\D/g, '')}`}
        className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border bg-card text-body font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1"
      >
        <Phone className="size-4" aria-hidden />
        {rent.branch.phone}
      </a>
    </div>
  )
}
