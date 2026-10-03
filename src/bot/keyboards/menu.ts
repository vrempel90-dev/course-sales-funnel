import { InlineKeyboard } from "grammy";
export const mainMenu = () =>
  new InlineKeyboard()
    .text("Подобрать обучение", "questionnaire")
    .row()
    .text("Мои курсы", "mycourses")
    .row()
    .text("Задать вопрос", "manager")
    .text("Помощь", "help");
export const navigation = () =>
  new InlineKeyboard().text("Назад", "catalog").text("Главное меню", "menu");
export const courseKeyboard = (id: string) =>
  new InlineKeyboard()
    .text("Подробнее", `open:${id}`)
    .text("Демо-урок", `demo:${id}`)
    .row()
    .text("Купить", `buy:${id}`)
    .text("Задать вопрос", `manager:${id}`)
    .row()
    .text("Главное меню", "menu");
export const experienceLabels = {
  BEGINNER: "Я начинающий",
  PRACTICING: "Уже занимаюсь массажем",
  PROFESSIONAL: "Работаю профессионально",
  UPSKILLING: "Хочу повысить квалификацию",
};
export const goalLabels = {
  NEW_PROFESSION: "Освоить новую профессию",
  NEW_SERVICE: "Добавить новую услугу",
  PERSONAL: "Обучиться для себя",
  UPSKILLING: "Повысить квалификацию",
};
