import { setupWorker } from 'msw/browser'
import { publicRentLinkHandlers } from './handlers/public-rent-link'

/**
 * Бекенд прототипу. В основній системі ці ж хендлери піднімаються поруч із десятками інших;
 * тут вони — єдиний сервер, який має сторінка. Стан (сесії, лічильник спроб,
 * виставлений рахунок) живе в модулі хендлерів і обнуляється перезавантаженням
 * вкладки — цього досить, щоб пройти сценарій і почати спочатку.
 */
export const worker = setupWorker(...publicRentLinkHandlers)
