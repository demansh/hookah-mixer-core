# hookah-mixer-core

Ядро Hookah Mixer: база знаний о сочетаниях ароматов для кальяна и движок, который превращает описание
настроения («свежие тропические фрукты с холодком», «Бледный Петербург») в три микса из 3–4 ароматов с процентами.

Ядро ничего не знает об интерфейсе: работает в браузере и в Node, без сервера, без сети и без ИИ-моделей.
Клиент — веб-приложение [Hookah Mixer](https://demansh.github.io/hookah-mixer/) (репозиторий `hookah-mixer`).

## Что внутри

```
data/                    база знаний — правится руками
  tags.csv               ароматы и свойства вкуса
  pairings.csv           карта сочетаемости пар ароматов
  category_affinity.csv  сочетаемость категорий (запасная оценка)
  concepts.yaml          образы: фразы → ароматы
  eval/queries.jsonl     заготовка проверочных запросов
src/                     движок (ES-модули без зависимостей)
  index.js               публичный API — импортировать только отсюда
  catalog.js, flavors.js, mix-link.js, engine/*
tools/                   валидатор, сборка и диагностика (Node)
  wordforms.json         регрессионный список словоформ
dist/                    готовый комплект для клиентов — генерируется `npm run build`
  data/*.json            собранная база
  js/                    копия src/
  VERSION
```

## Установка

Нужен Node 18 или новее. Зависимость одна — `yaml`, и только для инструментов: в `dist/` её нет.

```bash
cd ~/dev/pet/hookah-mixer-core
npm install
npm run build     # проверит данные и соберёт dist/
```

## Быстрый старт

### В браузере (как в приложении)

Скопируйте `dist/` к себе (в приложении это делает `tools/sync-core.sh`) и импортируйте API:

```js
import { loadCatalog, recommend, createSessionSeed } from './core/js/index.js';

const catalog = await loadCatalog('./core/data');
const seed = createSessionSeed();

const { profile, mixes } = await recommend({ query: 'тропические фрукты с холодком', seed }, catalog, 0);
mixes.forEach((mix) => console.log(mix.tier, mix.components, mix.note?.ru));
// например: classic  [{ flavorId: 'mango', share: 45 }, { flavorId: 'pineapple', share: 45 }, { flavorId: 'cooling', share: 10 }]
//          «ананас освежает густое манго сочной кислинкой»
```

### В Node

```js
import { readFileSync } from 'node:fs';
import { createCatalog, recommend, flavorLabel } from 'hookah-mixer-core';

const read = (name) => JSON.parse(readFileSync(`dist/data/${name}.json`, 'utf8'));
const catalog = createCatalog({ flavors: read('flavors'), graph: read('graph'), concepts: read('concepts') });

const { mixes } = await recommend({ query: 'мохито' }, catalog);
console.log(mixes[0].components.map((c) => `${flavorLabel(catalog.flavorsById.get(c.flavorId), 'ru')} ${c.share}%`));
// [ 'лайм 30%', 'мята 30%', 'ром 30%', 'холодок 10%' ]
```

## API

Всё экспортируется из `src/index.js` (в комплекте — `dist/js/index.js`). Остальные модули — внутренние,
их сигнатуры могут меняться без предупреждения.

### Каталог

| Функция | Описание |
|---------|----------|
| `loadCatalog(dataUrl, fetchImpl = fetch)` | загружает `flavors.json`, `graph.json`, `concepts.json` из каталога и возвращает каталог |
| `createCatalog({ flavors, graph, concepts })` | то же из уже разобранного JSON (Node, тесты, свои загрузчики) |

Каталог — объект `{ flavors, graph, concepts, flavorsById, termIndex }`. Передавайте его во все функции
как есть; один и тот же объект можно переиспользовать (внутри кэшируются граф и словарь).

### Подбор миксов

```js
const result = await recommend({ query, seed }, catalog, page = 0);
// result = { profile, mixes }
```

- `query` — строка пользователя; пустая или непонятная → случайные миксы (`profile.isRandom === true`).
- `seed` — целое число. Одинаковые `query + seed + page` дают одинаковый результат. Без `seed` движок полностью
  детерминирован и не встряхивает оценки (так работают проверки). В приложении зерно выбирается раз за сессию.
- `page` — номер перегенерации: `0, 1, 2…` дают новые тройки без повторов; когда варианты кончаются, страница
  возвращается пустой — клиент сам решает, начать ли с нуля.
- `mixes` — до `MIXES_PER_PAGE` (3) миксов:

```js
{
  tier: 'classic' | 'balanced' | 'bold',          // классика с изюминкой / эксперимент / смелое
  components: [{ flavorId: 'mango', share: 45 }],  // 3–4 аромата, доли кратны 5, сумма 100
  note: { ru: '…', en: '…' } | null,               // пояснение к самой интересной паре
}
```

### Подбор миксов по выбору (без текста)

Для интерфейсов на тапах: клиент передаёт не строку, а структуру из id каталога.

```js
const result = await recommendSelection({
  concepts: { 'tropical-fruits': 1 },   // образы → сила (умножает веса ароматов и свойств образа)
  flavors: { mango: 1.5 },              // желательные ароматы → вес (не обязательны в каждом миксе)
  properties: { sweet: 1.5 },           // свойства вкуса → сила сдвига
  required: ['passion_fruit'],          // будут в каждом миксе, не больше MAX_REQUIRED_FLAVORS (3)
  excluded: ['coconut'],                // не появятся ни в одном миксе
  seed,
}, catalog, page = 0);
// result = { profile, mixes } — как у recommend
```

- Все поля, кроме `seed`, необязательны. Веса — числа в `(0, MAX_SELECTION_WEIGHT]` (`3`). Текстовый запрос даёт
  вес `1` (частичное совпадение с образом — `0.5`); `1.5–2` — заметный сдвиг, `3` — сдвиг перекрывает образ.
- Id: образы — `catalog.concepts[].id` (у понятных гостю `chip: true`), ароматы — `catalog.flavors` с
  `kind: 'flavor'`, свойства — с `kind: 'property'` (`sweet`, `sour`, `fresh`, `creamy`, `spicy`, `bitter`).
  Холодок — обычный аромат `cooling`: «холоднее» = `required: ['cooling']` или `flavors: { cooling: … }`.
- Выбор проверяется строго: неизвестное поле или id, вес вне диапазона, больше трёх обязательных, один аромат
  и в `required`, и в `excluded` → исключение `SelectionError` со списком `issues`. Проверить заранее —
  `normalizeSelection(selection, catalog)`: вернёт канонический вид (все поля, ключи по алфавиту) или бросит ошибку.
- Пустой выбор (или только `excluded`) → случайные миксы, как пустой запрос (`profile.isRandom === true`).
- Страницы и зерно работают как у `recommend`; одинаковые выбор + `seed` + `page` → одинаковый результат.

### Разбор запроса

```js
const profile = parseQuery('манго с мятой, без кокоса', catalog);
profile.required;        // ['mango', 'mint'] — названы прямо, будут в каждом миксе (не больше MAX_REQUIRED_FLAVORS = 3)
profile.excluded;        // Set { 'coconut' }
profile.selection;       // { concepts: {}, flavors: {}, properties: {}, required: ['mango', 'mint'], excluded: ['coconut'] }
profile.matched;         // [{ type: 'flavor', id: 'mango', negated: false, partial: false, spans: [{ start: 0, end: 5 }] }, …]
profile.weights;         // Map ароматов профиля → вес
profile.properties;      // Map свойств (sweet, sour, fresh, creamy, spicy, bitter) → вес
profile.contradictions;  // ароматы, которые и названы, и исключены
profile.isEmpty;         // ничего не распознано
```

`profile.selection` — тот же запрос в виде выбора: `recommendSelection({ ...profile.selection, seed })` даёт те же
миксы, что `recommend({ query, seed })` (кроме случайного режима). Так можно начать с текста и дальше менять выбор
тапами. Отрицание «без» действует на всё, что идёт после него: «без кокоса, сладкий» исключит кокос и
проигнорирует «сладкий».

`spans` — позиции распознанных слов в исходной строке. С ними и `removeSpans(text, spans)` клиент может аккуратно
вырезать аромат из запроса вместе с висящим предлогом:

```js
import { parseQuery, removeSpans } from './core/js/index.js';
const query = 'тропики с манго';
const spans = parseQuery(query, catalog).matched.filter((m) => m.id === 'mango').flatMap((m) => m.spans);
removeSpans(query, spans); // 'тропики'
```

### Пояснения и ссылки на микс

```js
import { noteForMix, mixToParams, parseMixParams, mixShareText, mixFlavorQuery } from './core/js/index.js';

noteForMix(mix, catalog);                       // { ru, en } | null — пересчитать пояснение для любого микса
const params = mixToParams(mix, 'тропики');     // URLSearchParams { mix: 'mango.45,pineapple.45,cooling.10', tier: 'classic', q: 'тропики' }
// params.toString() кодирует запятые как %2C — для красивой ссылки замените их обратно: .replace(/%2C/gi, ',')
const parsed = parseMixParams(params, catalog); // { mix, query } или null, если ссылка повреждена
mixShareText(mix, catalog, 'ru');               // 'Манго 45% · ананас 45% · холодок 10% — Hookah Mixer'
mixFlavorQuery(mix, catalog, 'ru');             // 'Манго, ананас' — запрос «подобрать похожие» (без холодка)
```

`parseMixParams` строгий: только известные ароматы, 2–4 штуки, без повторов, доли кратны 5 и в сумме 100.
Всё остальное — `null`. Выводить названия в DOM только через `textContent`.

### Прочее

| Экспорт | Назначение |
|---------|-----------|
| `createSessionSeed()` | случайное зерно для сессии |
| `isIngredient(flavor)` | `true` для ароматов, `false` для свойств вкуса |
| `flavorLabel(flavor, lang)` | название аромата на `'ru'` или `'en'` |
| `MAX_REQUIRED_FLAVORS`, `MIXES_PER_PAGE`, `MAX_SELECTION_WEIGHT` | 3, 3 и 3 |
| `normalizeSelection(selection, catalog)`, `SelectionError` | проверка выбора для `recommendSelection` |
| `CORE_VERSION` | версия ядра, совпадает с `package.json` |

## Интеграция с приложением Hookah Mixer

Приложение — статический сайт без сборщика. Ядро попадает в него копированием `dist/`:

```bash
# в ядре
npm run build
git add -A && git commit -m "…" && git push

# в приложении
cd ~/dev/pet/hookah-mixer
./tools/sync-core.sh          # копирует ../hookah-mixer-core/dist → assets/core
git add -A && git commit -m "Update core to $(cat assets/core/VERSION)" && git push
```

В приложении ядро импортируется как `./core/js/index.js` относительно `assets/`, данные лежат в
`assets/core/data/`. Руками в `assets/core/` ничего не правят — только через ядро и синхронизацию.

## База знаний

Все файлы в `data/` правятся руками (в этом проекте — AI-агентом). Названия и синонимы — без учёта регистра,
`ё` = `е`, списки внутри ячейки CSV — через `|`.

| Файл | Строка | Пример |
|------|--------|--------|
| `tags.csv` | аромат или свойство: `id, category, role, intensity, sweet, sour, fresh, ru, en, synonyms_ru, synonyms_en, description_ru, description_en` | `chamomile,floral,accent,3,2,0,2,ромашка,chamomile,ромашковый чай,camomile\|chamomile tea,мягкий медово-травяной цветок с яблочной ноткой,…` |
| `pairings.csv` | пара: `a, b, affinity (−1..1), familiarity (classic/known/rare), note_ru, note_en` | `chamomile,honey,0.8,known,ромашковый чай с мёдом — классика спокойного вечера,…` |
| `category_affinity.csv` | пара категорий: `a, b, affinity` | `fruit_tropical,citrus,0.8` |
| `concepts.yaml` | образ: `id, chip?, phrases_ru, phrases_en, tags {аромат или свойство: вес 0.1–1}, avoid` | см. ниже |

```yaml
- id: bedtime
  phrases_ru: [перед сном, вечерний чай, спокойной ночи, что-то успокаивающее]
  phrases_en: [before bed, bedtime, good night, something soothing]
  tags: {chamomile: 1.0, honey: 0.6, lavender: 0.5, vanilla: 0.3}
  avoid: [energy_drink, coffee, chili]
```

`chip: true` — образ понятен гостю и годится в ленту примеров приложения (первая фраза показывается на чипе).

**Главное правило: id ароматов не переименовывать и не удалять.** На них ссылаются сохранённое избранное
и отправленные ссылки на миксы у пользователей.

## Как вносить изменения

### Изменение данных

```bash
# 1. отредактировать data/*
npm run validate          # 0 errors — обязательно
npm run build             # собрать dist/
npm run check:words       # словоформы не сломались
npm run check:sweep       # каждый аромат, свойство и фраза образа даёт 3 микса
npm run diagnose -- "запрос, ради которого меняли"
```

Новый аромат добавляется так (сначала проверьте, не выражается ли он уже сочетанием существующих: «облепиховый
чай» — это пара `sea_buckthorn` + `black_tea`, а не новый аромат):

1. строка в `tags.csv` (уникальный `id`, категория из существующих, роль, интенсивность, синонимы — другие слова,
   а не словоформы: формы движок понимает сам);
2. 15–30 строк в `pairings.csv`: известные сочетания, редкие находки с пояснениями, конфликты;
3. при необходимости — аромат в подходящие образы `concepts.yaml`;
4. новые словоформы — в `tools/wordforms.json` (`"с ромашкой": "chamomile"`);
5. `npm run check` и `npm run build`.

### Изменение движка

Код в `src/`. Константы вынесены в начало файлов. После правки:

```bash
npm run check:words && npm run check:sweep
npm run diagnose -- --pages=3 "запрос-пример"
npm run diagnose -- --seed=12345 "запрос-пример"   # воспроизвести выдачу пользователя (зерно из ?debug=1 приложения)
npm run diagnose -- --selection='{"concepts":{"tropical-fruits":1},"properties":{"sweet":1.5}}'   # выбор вместо текста
```

Если поменялся публичный API или поведение, заметное клиенту, — обновите этот README и `CHANGELOG.md`.

### Версии

Семантическое версионирование: исправление данных или багов — patch (`0.1.1`), новая возможность — minor
(`0.2.0`), несовместимое изменение API — major. Версию менять в двух местах: `package.json` и `CORE_VERSION`
в `src/index.js` — `npm run build` откажется собирать, если они разошлись. Запись в `CHANGELOG.md` обязательна.

## Проверки

Unit-тестов нет. Качество держится на валидаторе данных и трёх диагностических командах:

| Команда | Что проверяет | Эталон сейчас |
|---------|---------------|---------------|
| `npm run validate` | форматы, ссылки между файлами, дубли терминов, диапазоны, конфликт фраз образов | 0 errors, 0 warnings |
| `npm run check:words` | регрессия распознавания: словоформы и посторонние слова (`tools/wordforms.json`) | 83/83, 12/12 |
| `npm run check:sweep` | все ароматы, свойства и фразы образов на двух языках: 3 микса, доли = 100, без случайного режима; выбор из каждого запроса даёт те же миксы; каждый образ, свойство и аромат через `recommendSelection` | 889 запросов + 223 выбора, 0 проблем |
| `npm run diagnose -- "запрос"` | разбор, пул кандидатов, миксы по страницам — для разбора конкретных случаев | — |
| `npm run check` | validate + check:words + check:sweep | — |

Пример вывода `diagnose`:

```
=== "ромашка"
matched:       flavor:chamomile
weights:       chamomile:1
required:      chamomile   excluded: —   avoid: —
pool:          11 optional [мёд, лимон, мята, зелёный чай, яблоко, груша, абрикос, персик, ваниль, лаванда, бузина]
               core=chamomile cooling=none candidates=53
page 0:
  classic  ромашка 55% · лимон 30% · мёд 15%   // ромашковый чай с мёдом — классика спокойного вечера
```
