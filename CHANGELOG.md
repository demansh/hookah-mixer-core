# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

## [0.2.0] — 2026-10-27

### Добавлено
- `recommendSelection({ concepts, flavors, properties, required, excluded, seed }, catalog, page)` — подбор миксов
  по структурному выбору из id каталога, без текста. Веса образов, ароматов и свойств задаются числом
  до `MAX_SELECTION_WEIGHT` (3), поэтому сдвиги вкуса можно усиливать.
- `normalizeSelection` и `SelectionError` — строгая проверка выбора с понятным списком ошибок.
- `parseQuery(...).selection` — текстовый запрос в виде выбора; `recommendSelection` с ним даёт те же миксы.
- `diagnose --selection='{…}'`; `check:sweep` проверяет совпадение текста и выбора для всех запросов и прогоняет
  каждый образ, свойство и аромат через `recommendSelection`.

### Изменено
- Профиль строится одной функцией для текста и выбора (`src/engine/selection.js`). Выдача `recommend` по тексту
  не изменилась: сверено по всем известным запросам, трём зёрнам и трём страницам.
- `MAX_REQUIRED_FLAVORS` переехала в `selection.js` (публичный экспорт тот же).

## [0.1.0] — 2026-10-26

### Добавлено
- Ядро вынесено из приложения Hookah Mixer в отдельный репозиторий без изменения поведения.
- Публичный API в `src/index.js`: `createCatalog`, `loadCatalog`, `recommend`, `parseQuery`, `noteForMix`,
  `mixToParams`, `parseMixParams`, `mixShareText`, `mixFlavorQuery`, `removeSpans`, `createSessionSeed`,
  `isIngredient`, `flavorLabel`, `MAX_REQUIRED_FLAVORS`, `MIXES_PER_PAGE`, `CORE_VERSION`.
- Инструменты на Node вместо Python: `validate`, `build` (→ `dist/`), `diagnose`, `check:words`, `check:sweep`.
- База знаний: 103 аромата, 6 свойств вкуса, 1197 пар, 171 пара категорий, 114 образов.

### Изменено
- `mixShareText` и `mixFlavorQuery` принимают язык третьим параметром вместо обращения к i18n интерфейса.
