# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

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
