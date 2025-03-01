# ⭐ If it's useful, give it a star ⭐

# SquadJS-Playtime-Role-Ban

# English

A script for SquadJS, whose task is to block a role for a player if his total time in the game is less than the time required for the role

Role blocking is performed by removing a player from the squad (the role is reset in this case).

**Tested on SquadJS 4.1.0**

## Main features

- Query total time of players via Steam API
- Blocking unlimited number of roles by time in the game via regular expressions of any complexity
- Blocking squad leader until a certain time in the game
- Work starting from the set threshold of players on the server
- Showing blocked roles to the player when logging into the server and via the **!blocked** command (by default).
- Manual update of player's time via **!update** (default), in case the player opened his profile while on the server.
- Show player's total time in the game when logging in to the server

## Installation

Install the y18n library in Squadjs.

```
npm install y18n
```

- Download and install Playtime-Service [https://github.com/ar1ocker/Playtime-Service](https://github.com/ar1ocker/Playtime-Service)

- Download the repository Playtime-Service-JS-Lib

```
git clone https://github.com/ar1ocker/Playtime-Service-JS-Lib
```

- Copy the `Playtime-Service-JS-Lib/playtime-service-api.js` plugin to `squadjs/squad-server/plugins/` folder

- Download the repository SquadJS Random Patches

```
git clone https://github.com/ar1ocker/SquadJS-Random-Patches
```

- Apply the new-emit.patch while in the `<path to squadjs on the server>/` folder.

```
git apply <path to patch file> --verbose
```

- Download the repository

```
git clone https://github.com/ar1ocker/SquadJS-Playtime-Role-Ban
```

Copy the `playtime-role-ban.js` plugin, `playtime-searcher.js` module and the `playtime-role-ban-locales` folder to the `squadjs/squad-server/plugins` folder

## Settings

Basically similar to any other plugin for SquadJS, but you will need a steam API key to get the game time of users who log in to the server.

The plugin language is configured via the config parameter - language

**STEAM KEY IS BEST TAKEN FROM AN EMPTY ACCOUNT, THE KEY HAS TOO MANY PERMISSIONS, IF STOLEN IT WILL BE A NUISANCE**.

**Steam allows you to get API key only for accounts that have 5 euros on their account or the total price of games - 5 euros**.

You can get API key at [steam dev](https://steamcommunity.com/dev/apikey).

If the user has hidden his time in the game - the script will ask to open the profile

# Russian

![Screenshot_10](https://github.com/user-attachments/assets/97f94820-555e-4635-9fd8-cbdf1e71cbe5)

![Screenshot_11](https://github.com/user-attachments/assets/be61deb1-b67f-4a08-94a7-f88d201efb3e)

Скрипт для SquadJS, задача которого - заблокировать роль для игрока если его общее время в игре меньше чем требуется для роли

Блокировка роли происходит путём удаления игрока из отряда (роль в таком случае сбрасывается)

**Работоспособность проверена на версии SquadJS 4.1.0**

## Основные фишки

- Запрос суммарного времени игроков через API Steam
- Блокировка неограниченного количества ролей по времени в игре через регулярные выражения любой сложности
- Блокирование лидерства в скваде (squad leader) до определенного времени в игре
- Работа начиная с выставленного порога игроков на сервере
- Показ игроку заблокированных для него ролей при входе на сервер и через команду **!blocked** (по умолчанию)
- Ручное обновление времени игрока через команду **!update** (по умолчанию), на случай если игрок открыл свой профиль находясь на сервере
- Показ игроку его суммарного времени в игре при входе на сервер

## Установка

Установите библиотеку y18n в Squadjs

```
npm install y18n
```

- Скачайте и установите [https://github.com/ar1ocker/Playtime-Service](https://github.com/ar1ocker/Playtime-Service)

- Скачайте репозиторий Playtime-Service-JS-Lib

```
git clone https://github.com/ar1ocker/Playtime-Service-JS-Lib
```

- Скопируйте `Playtime-Service-JS-Lib/playtime-service-api.js` плагин в папку `squadjs/squad-server/plugins/`

- Скачайте репозиторий SquadJS Random Patches

```
git clone https://github.com/ar1ocker/SquadJS-Random-Patches
```

- Примените патч new-emit.patch находясь в папке `<путь до squadjs на сервере>/`

```
git apply <путь до файла patch> --verbose
```

- Скачайте репозиторий SquadJS Playtime Role Ban

```
git clone https://github.com/ar1ocker/SquadJS-Playtime-Role-Ban
```

Скопируйте плагин `playtime-role-ban.js`, `playtime-searcher.js` модуль и папку `playtime-role-ban-locales` в папку `squadjs/squad-server/plugins`

## Настройка

В основном аналогична любым другим плагинам для SquadJS, но вам нужен будет API ключ от аккаунта steam, чтобы получать время игры пользователей которые заходят на сервер.

Настройка языка плагина осуществляется через параметр конфига - language, русский язык тоже доступен

**КЛЮЧ ОТ АККАУНТА STEAM ЛУЧШЕ БРАТЬ ОТ ПУСТОГО АККАУНТА, КЛЮЧ ИМЕЕТ СЛИШКОМ МНОГО ПРАВ, ЕСЛИ УКРАДУТ - БУДЕТ НЕПРИЯТНО**

**Steam позволяет получать API ключ только для аккаунтов у которых если на счету 5 евро либо суммарная цена игр - 5 евро**

Получить API ключ можно на [steam dev](https://steamcommunity.com/dev/apikey)

Если пользователь скрыл своё время в игре - скрипт попросить открыть профиль
