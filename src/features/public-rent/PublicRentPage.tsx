/*
 * DIRECTION CONTRACT — публічна сторінка самообслуговування (seed 925c1388)
 *
 * THESIS: сторінка, де дія не подорожує екраном. Відмовляється від стандартної
 *   мобільної стрічки карток із CTA десь унизу документа.
 * OWN-WORLD: система BP Space без змін — Inter, 13px тіло, hairline #e1ddd9,
 *   плоскі поверхні, колір лише як стан. Бренд-navy живе рівно на одному
 *   екрані до верифікації.
 * STORY: клієнт входить за своїм номером, бачить усі свої оренди, відкриває ту,
 *   що спливає, продовжує строк і платить, не телефонуючи.
 * FIRST VIEWPORT: navy-шапка з логотипом і обіцянкою «Ваші оренди», під нею
 *   білий лист із полем номера; первинна дія — «Отримати код», під пальцем.
 * FORM: консоль під великий палець — кандидат 7 з упорядкованого списку,
 *   seed 925c1388.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 *   finish review, the verdict, and DESIGN.md
 */
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Clock } from 'lucide-react'
import {
  PublicRentError,
  extendRent,
  fetchPaymentStatus,
  fetchRent,
  fetchSession,
  payTopup,
  type PayMethod,
  type PayMode,
} from './api'
import { GateScreen } from './GateScreen'
import { RentList } from './RentList'
import { RentRecord } from './RentRecord'
import { Console, type ConsoleMode } from './Console'
import { dateTime, daysBetween } from './format'

/** Сессия живёт 30 суток: переспрашивать код на каждый заход — терять клиента. */
const SESSION_TTL_MS = 30 * 24 * 3_600_000
const SESSION_KEY = (dataset: string) => `bp.public-rent.session.${dataset}`
const PAY_MODE_KEY = 'bp.public-rent.pay-mode'
const SIMULATE_KEY = 'bp.public-rent.simulate'

function readSession(dataset: string): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY(dataset))
    if (!raw) return null
    const v = JSON.parse(raw) as { session: string; savedAt: number }
    if (Date.now() - v.savedAt > SESSION_TTL_MS) return null
    return v.session
  } catch {
    return null
  }
}

export function PublicRentPage({ token: dataset }: { token: string }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<string | null>(() =>
    readSession(dataset),
  )
  const [openId, setOpenId] = useState<string | null>(null)
  const [mode, setMode] = useState<ConsoleMode>({ kind: 'idle' })
  const [candidateIso, setCandidateIso] = useState<string | null>(null)
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [payMode, setPayMode] = useState<PayMode>(
    () => (localStorage.getItem(PAY_MODE_KEY) as PayMode | null) ?? 'BANKS',
  )

  const sessionQ = useQuery({
    queryKey: ['public-session', dataset, session],
    queryFn: () => fetchSession(dataset, session!),
    enabled: session != null,
    retry: false,
  })

  const rentQ = useQuery({
    queryKey: ['public-rent', dataset, session, openId],
    queryFn: () => fetchRent(dataset, session!, openId!),
    enabled: session != null && openId != null,
    retry: false,
  })

  const rent = rentQ.data ?? null
  const status = rent?.topup?.status ?? 'NONE'

  const signOut = useCallback(() => {
    localStorage.removeItem(SESSION_KEY(dataset))
    setSession(null)
    setOpenId(null)
    setMode({ kind: 'idle' })
  }, [dataset])

  // Просроченная сессия — единственный отказ, который возвращает на вход.
  // Упавший запрос сюда не относится: это не «вы не авторизованы».
  const unauthorized = (e: unknown) =>
    e instanceof PublicRentError && e.failure.code === 'UNAUTHORIZED'
  useEffect(() => {
    if (unauthorized(sessionQ.error) || unauthorized(rentQ.error)) signOut()
  }, [sessionQ.error, rentQ.error, signOut])

  // Признак «счёт оплачен» приходит из 1С — страница его опрашивает, пока
  // висит ожидание, и ни менеджер, ни клиент для этого ничего не делают.
  useEffect(() => {
    if (status !== 'AWAITING' || !session || !openId) return
    const id = window.setInterval(() => {
      void fetchPaymentStatus(dataset, session, openId)
        .then((r) => {
          if (r.status !== 'AWAITING')
            void qc.invalidateQueries({ queryKey: ['public-rent', dataset] })
        })
        .catch(() => {
          // Обрыв связи при опросе — не событие для клиента: следующий тик
          // сходит ещё раз, статус на экране не врёт.
        })
    }, 3000)
    return () => window.clearInterval(id)
  }, [status, session, openId, dataset, qc])

  const onVerified = useCallback(
    (s: string) => {
      localStorage.setItem(
        SESSION_KEY(dataset),
        JSON.stringify({ session: s, savedAt: Date.now() }),
      )
      setSession(s)
    },
    [dataset],
  )

  const reload = useCallback(() => {
    setMode({ kind: 'idle' })
    setCandidateIso(null)
    void qc.invalidateQueries({ queryKey: ['public-rent', dataset] })
    void qc.invalidateQueries({ queryKey: ['public-session', dataset] })
  }, [qc, dataset])

  const failure = (e: unknown, fallback: string) => {
    const code = e instanceof PublicRentError ? e.failure.code : null
    if (code === 'STALE') return { kind: 'stale' as const }
    return { kind: 'failed' as const, message: fallback }
  }

  const extendM = useMutation({
    mutationFn: () =>
      extendRent(
        dataset,
        session!,
        openId!,
        candidateIso!,
        rent!.plannedReturnAt,
      ),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['public-rent', dataset] })
      await qc.invalidateQueries({ queryKey: ['public-session', dataset] })
      setMode(res.ok ? { kind: 'paying' } : { kind: 'unavailable' })
      if (!res.ok) setCandidateIso(null)
    },
    // Без этой ветки неудачное продление оставляло консоль в выборе даты
    // молча: клиент жал кнопку снова и снова, и ничего не происходило.
    onError: (e) =>
      setMode(
        failure(e, 'Не вдалося продовжити оренду. Перевірте зв’язок і спробуйте ще раз.'),
      ),
  })

  const payM = useMutation({
    mutationFn: (opts: { declared?: boolean }) =>
      payTopup(dataset, session!, openId!, method!, {
        declared: opts.declared,
        simulate:
          (localStorage.getItem(SIMULATE_KEY) as 'FULL' | 'PARTIAL' | null) ??
          'FULL',
      }),
    onSuccess: async (_res, vars) => {
      await qc.invalidateQueries({ queryKey: ['public-rent', dataset] })
      // Перевод по реквизитам — единственный способ, где после подтверждения
      // клиент ещё не заплатил: он уходит в банк, и счёт ждёт его на экране.
      setMode(
        method === 'BANK' && !vars.declared
          ? { kind: 'invoice' }
          : { kind: 'idle' },
      )
    },
    onError: (e) =>
      setMode(failure(e, 'Не вдалося записати оплату. Спробуйте ще раз.')),
  })

  if (!session) {
    return (
      <PhoneFrame
        dataset={dataset}
        payMode={payMode}
        onPayMode={(m) => {
          localStorage.setItem(PAY_MODE_KEY, m)
          setPayMode(m)
        }}
      >
        <GateScreen dataset={dataset} onVerified={onVerified} />
      </PhoneFrame>
    )
  }

  const frame = (children: React.ReactNode) => (
    <PhoneFrame
      dataset={dataset}
      payMode={payMode}
      onPayMode={(m) => {
        localStorage.setItem(PAY_MODE_KEY, m)
        setPayMode(m)
      }}
    >
      {children}
    </PhoneFrame>
  )

  if (openId == null) {
    if (sessionQ.isPending) return frame(<div className="h-full bg-card" />)
    if (sessionQ.isError || !sessionQ.data)
      return frame(<LoadFailure onRetry={reload} />)
    return frame(
      <RentList
        session={sessionQ.data}
        managerPhone="+380 (44) 000-00-01"
        onOpen={(id) => {
          setOpenId(id)
          setMode({ kind: 'idle' })
          setCandidateIso(null)
          setMethod(null)
        }}
        onSignOut={signOut}
      />,
    )
  }

  const back = () => {
    setOpenId(null)
    setMode({ kind: 'idle' })
    setCandidateIso(null)
    setMethod(null)
  }

  if (rentQ.isPending) return frame(<div className="h-full bg-card" />)
  if (rentQ.isError || !rent)
    return frame(<LoadFailure onRetry={reload} onBack={back} />)

  const single = (sessionQ.data?.rents.length ?? 0) <= 1

  return frame(
    <div className="flex h-full flex-col bg-card">
      <RentHeader
        rentCode={rent.rentCode}
        status={rent.status}
        plannedReturnAt={rent.plannedReturnAt}
        onBack={single ? undefined : back}
      />
      {/* Полосы групп идут во всю ширину, поэтому обрез у края консоли режет
          их пополам заметнее, чем прежние карточки. Удлинённая зона
          растворения (штатная — 1.75rem) снимает жёсткую линию среза. */}
      <main
        className="scroll-fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ '--sf-size': '3rem' } as React.CSSProperties}
      >
        <RentRecord
          rent={rent}
          candidateIso={mode.kind === 'picking' ? candidateIso : null}
        />
      </main>
      <Console
        rent={rent}
        mode={mode}
        payMode={payMode}
        candidateIso={candidateIso}
        method={method}
        pending={extendM.isPending || payM.isPending}
        onOpenPicker={() => {
          setCandidateIso(null)
          setMethod(null)
          setMode(rent.topup ? { kind: 'paying' } : { kind: 'picking' })
        }}
        onCancel={() => {
          setCandidateIso(null)
          setMode({ kind: 'idle' })
        }}
        onPick={setCandidateIso}
        onConfirmExtend={() => extendM.mutate()}
        onPickMethod={setMethod}
        onConfirmMethod={() => payM.mutate({})}
        onDeclarePaid={() => payM.mutate({ declared: true })}
        onReload={reload}
      />
    </div>,
  )
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'В оренді', className: 'bg-success-soft text-success-fg' },
  EXPIRING_SOON: {
    label: 'Спливає строк',
    className: 'bg-notice-soft text-notice-fg',
  },
  OVERDUE: { label: 'Прострочено', className: 'bg-danger-soft text-danger-fg' },
  // Закрытая аренда — тоже read-only случай. Без своей записи она
  // проваливалась в фолбэк и уезжала зелёным чипом «В оренді».
  CLOSED: { label: 'Закрито', className: 'bg-muted text-muted-fg' },
}

/**
 * Чип считается от срока, а не берётся из ответа: после продления сервер
 * возвращает прежний статус аренды, и «Спливає строк» висел над возвратом,
 * до которого ещё пять суток.
 */
function chipFor(status: string, plannedReturnAt: string) {
  if (status === 'CLOSED') return STATUS_CHIP.CLOSED!
  const left = daysBetween(new Date().toISOString(), plannedReturnAt)
  if (left < 0) return STATUS_CHIP.OVERDUE!
  if (left <= 2) return STATUS_CHIP.EXPIRING_SOON!
  return STATUS_CHIP.ACTIVE!
}

function RentHeader({
  rentCode,
  status,
  plannedReturnAt,
  onBack,
}: {
  rentCode: string
  status: string
  plannedReturnAt: string
  onBack?: () => void
}) {
  const chip = chipFor(status, plannedReturnAt)
  return (
    <header className="shrink-0 border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="До списку оренд"
            className="-ml-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-fg transition-colors hover:bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        )}
        <span className="font-mono text-body tabular-nums text-fg">
          {rentCode}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-label font-medium ${chip.className}`}
        >
          {chip.label}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-label tabular-nums text-muted-fg">
          <Clock className="size-3.5" aria-hidden />
          {dateTime(plannedReturnAt)}
        </span>
      </div>
    </header>
  )
}

/**
 * Упавший запрос — не «вы не авторизованы». Раньше любая пятисотка выкидывала
 * проверенного клиента на форму номера, и он проходил код заново.
 */
function LoadFailure({
  onRetry,
  onBack,
}: {
  onRetry: () => void
  onBack?: () => void
}) {
  return (
    <div className="flex h-full flex-col justify-center bg-card px-6">
      <p className="text-[22px] font-semibold leading-tight text-fg">
        Не вдалося завантажити
      </p>
      <p className="mt-2 text-body text-muted-fg">
        Схоже, зник зв’язок. Ваші дані на місці — спробуйте ще раз.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 inline-flex h-12 items-center justify-center rounded-md border border-fg bg-fg text-title font-medium text-primary-fg transition-colors hover:bg-fg-2"
      >
        Оновити
      </button>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-3 text-body text-muted-fg underline underline-offset-2 hover:text-fg"
        >
          До списку оренд
        </button>
      )}
    </div>
  )
}

/**
 * Страница мобильная, но открывают её и с ноутбука (менеджер показывает,
 * команда смотрит демо). На широком экране колонка встаёт по центру на
 * shell-подложке — так видно, что это телефон, а не недоверстанный десктоп.
 */
function PhoneFrame({
  dataset,
  payMode,
  onPayMode,
  children,
}: {
  dataset: string
  payMode: PayMode
  onPayMode: (m: PayMode) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full w-full flex-col items-center bg-shell">
      {showDemoBar() && (
        <DevBar dataset={dataset} payMode={payMode} onPayMode={onPayMode} />
      )}
      <div className="h-full w-full max-w-[440px] overflow-hidden border-border bg-card sm:my-4 sm:h-[calc(100%-2rem)] sm:rounded-lg sm:border sm:shadow-md">
        {children}
      </div>
    </div>
  )
}

const SCENARIOS: Array<{ token: string; label: string }> = [
  { token: 'demo', label: 'Базовий — три оренди на номері' },
  { token: 'single', label: 'Одна оренда — список пропускається' },
  { token: 'deposit', label: 'Застава покриває доплату' },
  { token: 'balance', label: 'Є баланс контрагента' },
  { token: 'holiday', label: 'Продовження через свято' },
  { token: 'busy', label: 'Дати зайняті' },
  { token: 'dupes', label: 'Два контрагенти на номері' },
  { token: 'blocked', label: 'ЧС — тільки перегляд' },
  { token: 'empty', label: 'Активних оренд немає' },
  { token: 'unknown', label: 'Номера немає в базі' },
  { token: 'gateway', label: 'Шлюз кодів недоступний' },
]

/**
 * В CRM панель жила под `import.meta.env.DEV` — там прод-сборка идёт клиенту.
 * Здесь прод-сборка и есть демо: без переключателей развилку оплаты Б не
 * показать вообще, а сценарий пришлось бы диктовать адресом. Убирается
 * параметром `?clean` — для показа, где переключатели мешают.
 */
function showDemoBar(): boolean {
  return !new URLSearchParams(window.location.search).has('clean')
}

/** Переключатели сценария, развилки оплаты и ответа 1С. */
function DevBar({
  dataset,
  payMode,
  onPayMode,
}: {
  dataset: string
  payMode: PayMode
  onPayMode: (m: PayMode) => void
}) {
  const [simulate, setSimulate] = useState(
    () => localStorage.getItem(SIMULATE_KEY) ?? 'FULL',
  )
  return (
    <div className="hidden w-full max-w-[440px] flex-col gap-2 pt-4 sm:flex">
      <div className="flex items-center gap-2">
        <label htmlFor="pr-scenario" className="w-20 text-label text-muted-fg">
          Сценарій
        </label>
        <select
          id="pr-scenario"
          value={dataset}
          onChange={(e) => {
            // `BASE_URL`, а не корень: на GitHub Pages сайт лежит в `/<repo>/`.
            window.location.href = `${import.meta.env.BASE_URL}o/${e.target.value}${window.location.search}`
          }}
          className="h-control flex-1 rounded-md border border-border-strong bg-card px-2 text-label text-fg"
        >
          {SCENARIOS.map((s) => (
            <option key={s.token} value={s.token}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="pr-paymode" className="w-20 text-label text-muted-fg">
          Оплата
        </label>
        <select
          id="pr-paymode"
          value={payMode}
          onChange={(e) => onPayMode(e.target.value as PayMode)}
          className="h-control flex-1 rounded-md border border-border-strong bg-card px-2 text-label text-fg"
        >
          <option value="BANKS">А — наші банки, без комісії</option>
          <option value="PROVIDER">Б — провайдер, Apple / Google Pay</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="pr-simulate" className="w-20 text-label text-muted-fg">
          З 1С
        </label>
        <select
          id="pr-simulate"
          value={simulate}
          onChange={(e) => {
            localStorage.setItem(SIMULATE_KEY, e.target.value)
            setSimulate(e.target.value)
          }}
          className="h-control flex-1 rounded-md border border-border-strong bg-card px-2 text-label text-fg"
        >
          <option value="FULL">Прийде вся сума</option>
          <option value="PARTIAL">Прийде частина — недоплата</option>
        </select>
      </div>
    </div>
  )
}
