import { useEffect, useRef, useState } from 'react'
import { Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'
import {
  PublicRentError,
  fetchDemo,
  requestCode,
  verifyCode,
  type PublicFailure,
} from './api'
import { channelName, isPhoneComplete, maskPhone, remaining } from './format'
import { BrandMark } from './BrandMark'

/**
 * Вход. Секрет здесь — код на номер, а не адрес страницы: ссылку клиент
 * пересылает в чат, и это нормально. Пока номер не подтверждён, страница не
 * знает об аренде ничего и показать ей нечего.
 *
 * Фирменная шапка не украшение: клиент приходит по ссылке из мессенджера на
 * незнакомый домен, и первое, что он должен опознать, — компанию, у которой
 * арендует. Дальше, на самих арендах, бренд уходит и остаётся хром системы.
 */
export function GateScreen({
  dataset,
  onVerified,
}: {
  dataset: string
  onVerified: (session: string) => void
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [channel, setChannel] = useState('SMS')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<PublicFailure | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  /**
   * ⚠️ ТОЛЬКО ПРОТОТИП. Оба поля приезжают заполненными: показ не должен
   * начинаться с набора чужого номера и шестизначного кода на чужом телефоне.
   * Поля остаются обычными — их можно стереть и ввести своё, чтобы показать
   * невірний код или незнайомий номер. В проде этого запроса нет: код знает
   * только владелец номера.
   */
  const [demoCode, setDemoCode] = useState('')
  useEffect(() => {
    let alive = true
    void fetchDemo(dataset)
      .then((d) => {
        if (!alive) return
        setPhone((v) => (v === '' ? d.phone : v))
        setDemoCode(d.code)
      })
      .catch(() => {
        // Набора нет (или он отвечает 404) — показываем пустую форму, как в
        // проде. Отдельного сообщения тут не нужно: следующий шаг всё скажет.
      })
    return () => {
      alive = false
    }
  }, [dataset])

  const lockUntil = failure?.code === 'LOCKED' ? failure.lockedUntil : 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (lockUntil <= now && resendAt <= now) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [lockUntil, resendAt, now])
  const locked = lockUntil > now
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    setFailure(null)
    try {
      await fn()
    } catch (e) {
      setFailure(
        e instanceof PublicRentError ? e.failure : { code: 'GATEWAY_DOWN' },
      )
    } finally {
      setPending(false)
    }
  }

  const send = (advance: boolean) =>
    run(async () => {
      const r = await requestCode(dataset, phone)
      setChannel(r.channel)
      setResendAt(Date.now() + r.resendAfter * 1000)
      if (advance) {
        setStep('code')
        setCode(demoCode)
      }
    })

  const submitCode = () =>
    run(async () => {
      const { session } = await verifyCode(dataset, phone, code)
      onVerified(session)
    })

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: 'var(--color-brand-navy)' }}
    >
      {/* Шапка забирает ВЕСЬ свободный ход, лист под ней сжат по содержимому.
          Так пустоту держит бренд, а не белое поле: форма стоит внизу, под
          пальцем, и дальше по флоу на этом же месте живёт консоль. */}
      <header className="flex min-h-0 flex-1 flex-col justify-end px-6 pb-8 pt-10">
        <BrandMark />
        <p className="mt-6 text-[26px] font-semibold leading-tight tracking-tight text-on-brand">
          Ваші оренди
        </p>
        <p className="mt-1 text-body text-on-brand-muted">
          Продовжити строк і сплатити — без дзвінка менеджеру
        </p>
      </header>

      {/* Лист с формой — перекрывает шапку скруглением, как выдвинутая карточка. */}
      <div className="flex max-h-full shrink-0 flex-col overflow-y-auto rounded-t-[20px] bg-card px-6 pb-8 pt-7">
        <div className="flex items-start gap-2.5">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-muted-fg"
            aria-hidden
          />
          <p className="text-body text-muted-fg">
            {step === 'phone'
              ? 'Введіть номер, на який оформлено оренду. Ми надішлемо на нього код.'
              : `Код надіслали у ${channelName(channel)} на ${maskPhone(phone)}.`}
          </p>
        </div>

        {locked ? (
          <LockNotice msLeft={lockUntil - now} />
        ) : step === 'phone' ? (
          <form
            className="mt-7 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!pending) void send(true)
            }}
          >
            <label htmlFor="pr-phone" className="text-label font-medium text-fg">
              Номер телефону
            </label>
            {/* 16px, не 13: на iOS поле меньше 16px заставляет Safari
                зумить страницу на фокусе, и клиент попадает на увеличенный
                обрезанный экран. */}
            <input
              id="pr-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+380 __ ___ __ __"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={failure?.code === 'PHONE_UNKNOWN'}
              aria-describedby={failure ? 'pr-phone-error' : undefined}
              className="h-12 rounded-md border border-border-strong bg-card px-3 text-[16px] text-fg transition-colors placeholder:text-subtle focus:border-border-focus focus:outline-none aria-[invalid=true]:border-danger"
            />
            <GateError id="pr-phone-error" failure={failure} />
            <div className="pt-4">
              <GateButton
                pending={pending}
                disabled={!isPhoneComplete(phone)}
              >
                Отримати код
              </GateButton>
            </div>
          </form>
        ) : (
          <form
            className="mt-7 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!pending) void submitCode()
            }}
          >
            <label htmlFor="pr-code" className="text-label font-medium text-fg">
              Код із повідомлення
            </label>
            <input
              ref={codeRef}
              id="pr-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="——————"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={
                failure?.code === 'BAD_CODE' || failure?.code === 'CODE_EXPIRED'
              }
              aria-describedby={failure ? 'pr-code-error' : undefined}
              className="h-12 rounded-md border border-border-strong bg-card px-3 text-center text-[22px] tracking-[0.4em] tabular-nums text-fg transition-colors placeholder:tracking-[0.3em] placeholder:text-subtle focus:border-border-focus focus:outline-none aria-[invalid=true]:border-danger"
            />
            <GateError id="pr-code-error" failure={failure} />
            {demoCode !== '' && (
              <p className="text-label text-subtle">
                Прототип: код {demoCode} підставлено
              </p>
            )}
            <div className="flex flex-col items-start gap-3 pt-4">
              <GateButton pending={pending} disabled={code.length < 6}>
                Увійти
              </GateButton>
              {/* Без повторной отправки единственный выход при недоставленном
                  коде — «Змінити номер», то есть начать заново с правильного
                  номера. Это тупик, а не выход. */}
              <div className="flex w-full items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={resendIn > 0 || pending}
                  onClick={() => void send(false)}
                  className="text-body text-muted-fg underline underline-offset-2 hover:text-fg disabled:text-subtle disabled:no-underline"
                >
                  {resendIn > 0
                    ? `Надіслати ще раз можна через ${resendIn} с`
                    : 'Надіслати код ще раз'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone')
                    setFailure(null)
                  }}
                  className="shrink-0 text-body text-muted-fg underline underline-offset-2 hover:text-fg"
                >
                  Інший номер
                </button>
              </div>
            </div>
          </form>
        )}

        <p className="pt-6 text-label text-subtle">
          Питання —{' '}
          <a
            href="tel:+380440000001"
            className="text-muted-fg underline underline-offset-2"
          >
            +380 (44) 000-00-01
          </a>
          , щодня з 8:00 до 20:00
        </p>
      </div>
    </div>
  )
}

/**
 * Ошибка называет и причину, и выход. «Помилка входу» без продолжения
 * оставляет клиента с телефоном в руке и ничего не подсказывает.
 */
function GateError({
  id,
  failure,
}: {
  id: string
  failure: PublicFailure | null
}) {
  if (!failure) return null
  const text: Partial<Record<PublicFailure['code'], string>> = {
    PHONE_UNKNOWN:
      'На цей номер оренд не знайдено. Перевірте номер або зателефонуйте менеджеру — можливо, оренду оформлено на інший.',
    BAD_CODE:
      failure.code === 'BAD_CODE'
        ? `Код невірний. Залишилось спроб: ${failure.attemptsLeft}.`
        : '',
    CODE_EXPIRED: 'Код застарів — він діє 5 хвилин. Надішліть новий.',
    SMS_LIMIT:
      'Сьогодні код надсилали вже 5 разів. Спробуйте завтра або зателефонуйте менеджеру.',
    GATEWAY_DOWN:
      'Не вдалося надіслати код. Спробуйте ще раз за хвилину або зателефонуйте менеджеру.',
  }
  const msg = text[failure.code]
  if (!msg) return null
  return (
    <p id={id} role="alert" className="text-body text-danger-fg">
      {msg}
    </p>
  )
}

function GateButton({
  pending,
  disabled,
  children,
}: {
  pending: boolean
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
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

function LockNotice({ msLeft }: { msLeft: number }) {
  return (
    <div className="mt-7 flex flex-col items-start gap-2 rounded-md border border-danger/30 bg-danger-soft p-4">
      <LockKeyhole className="size-4 text-danger-fg" aria-hidden />
      <p className="text-title font-medium text-danger-fg">
        Ввід коду заблоковано
      </p>
      {/* «через 15 хв», а не «через 15:06»: mm:ss после «через» читается как
          время на часах, а не как остаток. Секунды появляются на последней
          минуте, когда они и правда что-то значат. */}
      <p className="text-body text-danger-fg">
        П'ять невірних спроб поспіль. Спробуйте ще раз{' '}
        <span className="tabular-nums">{remaining(msLeft)}</span> або
        зателефонуйте менеджеру.
      </p>
    </div>
  )
}
