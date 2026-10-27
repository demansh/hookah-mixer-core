---
name: release-to-app
description: Выпуск новой версии ядра Hookah Mixer и подключение её в веб-приложение — поднять версию, записать CHANGELOG, собрать dist, синхронизировать в ~/dev/pet/hookah-mixer. Use after any change to data/ or src/ that should reach the app, or when the user asks to update the core in the app.
---

# Выпуск ядра и подключение в приложение

## 1. Версия
- patch (`0.1.1`) — правки данных и багов без изменения API; minor (`0.2.0`) — новая возможность или новые
  экспорты; major — несовместимое изменение публичного API.
- Поменяй **в двух местах**: `package.json` → `version` и `src/index.js` → `CORE_VERSION`.
- Запись в `CHANGELOG.md` (Добавлено / Изменено / Исправлено), дата — сегодняшняя.

## 2. Сборка и проверки
```bash
npm run check            # validate + check:words + check:sweep — без ошибок
npm run build            # dist/; упадёт, если версии в package.json и src/index.js разошлись
cat dist/VERSION
```

## 3. Подключение в приложение
```bash
cd ~/dev/pet/hookah-mixer
./tools/sync-core.sh     # копирует ../hookah-mixer-core/dist → assets/core
git status --short       # должны измениться только assets/core/* (и код приложения, если менялся API)
```
- Если менялся публичный API — поправь вызовы в `assets/js/` приложения (импорты только из `./core/js/index.js`
  относительно `assets/js/` → `../core/js/index.js`) и проверь страницу в headless Chrome (см. `CLAUDE.md`
  приложения, раздел про проверку UI).
- Руками в `assets/core/` ничего не править.

## 4. Коммиты (делает пользователь)
Дай две команды:
```bash
cd ~/dev/pet/hookah-mixer-core && git add -A && git commit -m "Core X.Y.Z: <что изменилось>" && git push
cd ~/dev/pet/hookah-mixer && git add -A && git commit -m "Update core to X.Y.Z" && git push
```
У репозитория ядра может ещё не быть remote — тогда push пропустить и подсказать пользователю создать репозиторий.
