// Doxi Input Understanding — deterministic keyboard-layout recovery.
// No network requests, external dependencies, or storage. Original user text remains unchanged.

const EN_TO_RU_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const EN_TO_RU_VALUES = "йцукенгшщзхъфывапролджэячсмитьбю.";
const EN_TO_RU_MAP = new Map(Array.from(EN_TO_RU_KEYS).map((key, index) => [key, EN_TO_RU_VALUES[index]]));
const EN_TO_RU_SHIFT = new Map([
  ["@", '"'], ["#", "№"], ["$", ";"], ["^", ":"], ["&", "?"],
  ["{", "Х"], ["}", "Ъ"], [":", "Ж"], ['"', "Э"], ["<", "Б"], [">", "Ю"], ["?", ","],
]);

// Common, unambiguous Russian words used only as a conservative confidence signal.
// This is not a spell-check dictionary and is never used to rewrite names or identifiers.
const COMMON_RU_WORDS = new Set((
  "привет здравствуйте здравствуй добрый доброе день вечер утро пока спасибо благодарю пожалуйста " +
  "как дела что это почему зачем когда где куда откуда кто кому кого чего какой какая какие какое " +
  "меня мне мной менях тебя тебе тобой вас вам вами вы твой ваша ваше ваши наш наша наши " +
  "понимаешь понимаете понимаю понимает поняла понял понятно понимание понять понимать " +
  "помоги помогите помощь помогу можешь можете можно нужно надо хочу хотел хотела хотели " +
  "давай давайте да нет хорошо отлично верно правильно ясно понятно конечно наверное " +
  "сегодня завтра вчера сейчас потом раньше позже всегда никогда иногда опять снова " +
  "работает работать работа проект система докслот аксон запись записи записей календарь " +
  "слот слоты поставщик поставщики склад складской складом складов загрузка данные данныех " +
  "информация вопрос ответ ответь скажи объясни покажи найди проверь сделай создай измени " +
  "удали исправь добавь открой закрой отправь подготовь посмотри посчитать посчитай " +
  "почему потому чтобы если тогда когда пока уже еще ещё только просто очень совсем " +
  "смысл смыслом текст сообщение написал написала написано набрал набрала набрано " +
  "ошибка ошибку ошибочный неправильно раскладка клавиатура перевод перевести переведи " +
  "понимаю понимаем понимаете меняем поменять менять работаете работаешь работаю " +
  "помощник помощница докси интернет поиск сайт сайты источник источники " +
  "сумма числа число результат результатом вопросом ответом " +
  "сотрудник сотрудники пользователь пользователи документ документа документы номер номера " +
  "план задача задачи проектом функция функции доступ доступен доступна " +
  "время дата даты завтра сегодня неделя месяц год годы " +
  "сколько сколько-то чей чья чье чьи этот эта это эти тот та те " +
  "всего уже еще далее далееже вместе отдельно можно ли нельзя " +
  "пожалуй вероятно возможно непонятно непонятный искаженный поврежденный " +
  "тест проверка пройдено готова готов проверить " +
  "поставить добавить настроить подключить установить установитьcя " +
  "стоимость цена цены сравнить сравнение анализ анализировать отчет отчёт " +
  "объяснение напиши ответить помочь вопрос ответ " +
  "понимаешь ли меня так ты я мы вы он она они " +
  "последний последняя последние актуальный актуальная актуальные новый новая новое новые " +
  "старый старая старое старые полный полная кратко подробнее " +
  "можно нужно надо не без для про при по на в из от до с со за " +
  "есть будет был была было были быть "
).split(/\s+/u));

function hasProtectedTechnicalShape(text: string): boolean {
  return (
    /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Z]{2,}/iu.test(text) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(text) ||
    /```|`|\b(?:select|insert|update|delete|create|alter|drop|from|where|join|function|const|let|var|return|import|export|async|await|class|interface|supabase|ollama|powershell|typescript|javascript)\b/iu.test(text) ||
    /[{}<>]/u.test(text) ||
    /(?:^|\s)[A-ZА-ЯЁ_][A-ZА-ЯЁ0-9_]{2,}(?:\s|$)/u.test(text) ||
    /(?:ВзУ|ИНН|КПП|UUID|ID|API[_ -]?KEY)\s*[-:#№]?\s*\w{3,}/iu.test(text) ||
    /(?:[A-Za-z]:\\|\\\\|\/mnt\/|\/home\/|\.\w{1,5}\b)/u.test(text)
  );
}

function mapEnglishKeyboardToRussian(text: string): string {
  return Array.from(text).map((character) => {
    const lower = character.toLowerCase();
    const mapped = EN_TO_RU_MAP.get(lower) ?? EN_TO_RU_SHIFT.get(character);
    if (!mapped) return character;
    return character !== lower && /^[а-яё]$/iu.test(mapped) ? mapped.toLocaleUpperCase("ru-RU") : mapped;
  }).join("");
}

export function buildInputRecoveryHint(input: string): { recoveredText: string; matchedWords: number; confidence: "high" } | null {
  const text = String(input || "").trim();
  if (text.length < 4 || text.length > 500 || hasProtectedTechnicalShape(text)) return null;
  if (/[\r\n]/u.test(text) || /\[Вложение:/iu.test(text)) return null;

  const latinLetters = (text.match(/[A-Za-z]/gu) || []).length;
  const cyrillicLetters = (text.match(/[А-Яа-яЁё]/gu) || []).length;
  const totalLetters = (text.match(/[\p{L}]/gu) || []).length;
  if (latinLetters < 4 || totalLetters === 0 || latinLetters / totalLetters < 0.8 || cyrillicLetters > 0) return null;

  const recoveredText = mapEnglishKeyboardToRussian(text);
  const candidateLetters = (recoveredText.match(/[А-Яа-яЁё]/gu) || []).length;
  const candidateTotalLetters = (recoveredText.match(/[\p{L}]/gu) || []).length;
  if (candidateTotalLetters === 0 || candidateLetters / candidateTotalLetters < 0.75) return null;

  const words = (recoveredText.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").match(/[а-я]{3,}/gu) || []);
  if (words.length === 0) return null;
  const matchedWords = words.filter((word) => COMMON_RU_WORDS.has(word)).length;
  const coverage = matchedWords / words.length;

  const strongSentence = words.length >= 2 && matchedWords >= 2 && coverage >= 0.6;
  const strongSingleWord = words.length === 1 && words[0].length >= 5 && matchedWords === 1;
  if (!strongSentence && !strongSingleWord) return null;

  return { recoveredText, matchedWords, confidence: "high" };
}
