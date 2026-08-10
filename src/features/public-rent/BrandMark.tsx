/**
 * Шапка бренда для публичной страницы.
 *
 * ⚠️ ЗАГЛУШКА ПО АССЕТУ. Готовые марки несут суффикс «CRM»: это айдентика
 * внутренней системы, а не компании, которая сдаёт инструмент. В ссылке из
 * SMS такое слово клиенту ничего не говорит и работает против доверия. Пока
 * клиентского логотипа нет, вордмарк набран типографикой самой системы —
 * подменить на реальный ассет здесь, в одном месте.
 */
export function BrandMark() {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-[28px] font-bold uppercase leading-none tracking-tight text-on-brand">
        Будпрокат
      </span>
      <span className="text-label tracking-wide text-on-brand-subtle">
        budprokat.kiev.ua
      </span>
    </div>
  )
}
