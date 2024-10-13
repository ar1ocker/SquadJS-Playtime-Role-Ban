import BasePlugin from './base-plugin.js';
import axios from 'axios';

// Метка в player_times которая означает что время пользователя неизвестно
const TIME_IS_UNKNOWN = -1;

const SQUAD_STEAM_ID = 393380;

export default class PlaytimeRoleBan extends BasePlugin {
  static get description() {
    return 'Removes player from squad due to time played';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      steam_api_key: {
        required: true,
        description:
          'API ключ от аккаунта пользователя steam, с помощью которого будет производиться поиск времени игры у пользователя',
        default: ''
      },
      banned_roles: {
        required: true,
        description: 'Список ролей которые должны быть забанены',
        default: [
          {
            roleRegex: '.*pilot.*', // Regex на название роли
            timePlayed: 1500, // Количество времени в часах до которого будет забанена роль
            description: 'Вертолетчик' // Описание роли которое выводится пользователю
          }
        ]
      },
      banned_squad_leader_playtime: {
        required: true,
        description: 'До какого количества часов забанена роль сквад лидера',
        default: 100
      },
      min_number_of_players_for_work: {
        required: true,
        description: 'После какого количества игроков начинает работать блокировка китов',
        default: 60
      },
      is_squad_leader_banned: {
        required: false,
        description: 'Забанена ли роль сквад лидера',
        default: true
      },
      show_users_their_blocked_roles: {
        required: false,
        description: 'Показывать ли пользователю заблокированные роли при входе на сервер',
        default: true
      },
      delay_to_show_blocked_roles_on_connected: {
        required: false,
        description: 'Задержка перед показом пользователю его заблокированных ролей',
        default: 20
      },
      show_users_their_time_on_connected: {
        required: false,
        description: 'Показывать ли пользователям их время при входе на сервер',
        default: true
      },
      delay_to_show_time_on_connected: {
        required: false,
        description: 'Задержка перед показом времени при входе на сервер, в секундах',
        default: 10
      },
      delay_before_remove_player_from_squad: {
        required: false,
        description:
          'Через какое время игрока удалять из сквада за заблокированную роль, в секундах',
        default: 10
      },
      update_playtime_command: {
        required: false,
        description: 'Команда на обновление времени игрока',
        default: 'update'
      },
      show_blocked_roles_command: {
        required: false,
        description: 'Команда на показ заблокированных ролей',
        default: 'blocked'
      },
      do_update_playtime_on_mount: {
        required: false,
        description: 'Обновлять ли время пользователей при запуске скрипта',
        default: true
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    // {steam_id: timePlayed}
    this.playersTimes = new Map();

    this.steamUserInfoAPI = axios.create({
      baseURL: `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/`,
      params: {
        key: this.options.steam_api_key,
        include_appinfo: true
      },
      timeout: 3000
    });

    this.showUserPlaytime = this.showUserPlaytime.bind(this);
    this.updatePlayerPlaytime = this.updatePlayerPlaytime.bind(this);
    this.updatePlaytimeOfPlayers = this.updatePlaytimeOfPlayers.bind(this);
    this.verifyPlayerRole = this.verifyPlayerRole.bind(this);
    this.removePlayerFromSquadForRole = this.removePlayerFromSquadForRole.bind(this);
    this.removePlayerFromSquadForSquadLeader = this.removePlayerFromSquadForSquadLeader.bind(this);
    this.showUserBlockedRoles = this.showUserBlockedRoles.bind(this);
  }

  async mount() {
    this.server.on(
      `CHAT_COMMAND:${this.options.update_playtime_command.toLowerCase()}`,
      async (data) => {
        await this.updatePlayerPlaytime(data.player.steamID);
        await this.showUserPlaytime(data.player.eosID);
      }
    );

    this.server.on(
      `CHAT_COMMAND:${this.options.show_blocked_roles_command.toLowerCase()}`,
      async (data) => {
        await this.updatePlayerPlaytime(data.player.steamID);
        await this.showUserBlockedRoles(data.player.eosID);
      }
    );

    this.server.on('PLAYER_CONNECTED', (data) => this.updatePlayerPlaytime(data.player.steamID));

    if (this.options.show_users_their_time_on_connected) {
      this.server.on('PLAYER_CONNECTED', (data) => {
        setTimeout(
          () => this.showUserPlaytime(data.player.eosID),
          this.options.delay_to_show_time_on_connected * 1000
        );
      });
    }

    if (this.options.show_users_their_blocked_roles) {
      this.server.on('PLAYER_CONNECTED', (data) => {
        setTimeout(
          () => this.showUserBlockedRoles(data.player.eosID),
          this.options.delay_to_show_blocked_roles_on_connected * 1000
        );
      });
    }

    this.server.on('PLAYER_ROLE_CHANGE', (data) => {
      if (this.server.players.length >= this.options.min_number_of_players_for_work) {
        this.verifyPlayerRole(data);
      }
    });

    this.server.on('PLAYER_POSSESS', (data) => {
      if (this.server.players.length >= this.options.min_number_of_players_for_work) {
        this.verifyPlayerRole(data);
      }
    });

    this.server.on('PLAYER_NOW_IS_LEADER', (data) => {
      if (this.server.players.length >= this.options.min_number_of_players_for_work) {
        this.verifyPlayerSquadLeader(data);
      }
    });

    if (this.options.do_update_playtime_on_mount) {
      await this.updatePlaytimeOfPlayers(this.server.players);
    }

    this.verbose(1, 'Плагин был примонтирован');
  }

  async verifyPlayerRole(playerRoleData) {
    const playerPlaytime = this.getPlayerPlaytime(playerRoleData.player.eosID);

    const allBlockedRoles = this.getBlockedRoles(playerPlaytime);

    if (allBlockedRoles.length === 0) {
      this.verbose(
        1,
        `У игрока ${playerRoleData.player.eosID} время игры больше чем все заблокированные роли: ${playerPlaytime} часов, играет на разрешенной роли ${playerRoleData.player.role}`
      );
      return;
    }

    const blockedRole = this.searchRoleInList(playerRoleData.player.role, allBlockedRoles);

    if (blockedRole === undefined) {
      this.verbose(
        1,
        `Игрок ${playerRoleData.player.eosID} со временем в игре ${playerPlaytime} играет на разрешенной роли ${playerRoleData.player.role}`
      );
      return;
    }

    this.verbose(
      1,
      `Обнаружен игрок ${playerRoleData.player.eosID} со временем игры ${playerPlaytime} часов и китом ${playerRoleData.player.role} подпадающим под фильтр ${blockedRole.description}, процесс удаления его из отряда запущен`
    );

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(
        playerRoleData.player.eosID,
        'Твоё время в игре неизвестно! Открой профиль Steam чтобы мы могли разрешить тебе роли.'
      );
    }

    await this.server.rcon.warn(
      playerRoleData.player.eosID,
      `Роль (${blockedRole.description}) заблокирована до ${blockedRole.timePlayed} часов игры, ВОЗЬМИ ДРУГУЮ. ${this.options.delay_before_remove_player_from_squad} секунд.`
    );
    setTimeout(
      () => this.removePlayerFromSquadForRole(blockedRole, playerRoleData.player.eosID),
      this.options.delay_before_remove_player_from_squad * 1000
    );
  }

  async verifyPlayerSquadLeader(playerData) {
    const playerPlaytime = this.getPlayerPlaytime(playerData.player.eosID);

    if (playerPlaytime < this.options.banned_squad_leader_playtime && playerData.player.isLeader) {
      if (playerPlaytime === TIME_IS_UNKNOWN) {
        await this.server.rcon.warn(
          playerData.player.eosID,
          'Твоё время в игре неизвестно! Открой профиль Steam чтобы мы могли разрешить тебе роли.'
        );
      }

      this.verbose(
        1,
        `Обнаружен сквадной ${playerData.player.eosID} со временем игры ${playerPlaytime} часов, процесс удаления его из отряда запущен`
      );

      await this.server.rcon.warn(
        playerData.player.eosID,
        `Запрещено быть сквадным до ${this.options.banned_squad_leader_playtime} часов игры, РАСФОРМИРУЙ отряд или ПЕРЕДАЙ роль! ${this.options.delay_before_remove_player_from_squad} секунд.`
      );

      setTimeout(
        () => this.removePlayerFromSquadForSquadLeader(playerData.player.eosID),
        this.options.delay_before_remove_player_from_squad * 1000
      );
    } else {
      this.verbose(
        1,
        `Обнаружен сквадной ${playerData.player.eosID} со временем игры ${playerPlaytime} часов, роль сквадного ему разрешена по времени`
      );
    }
  }

  async removePlayerFromSquadForRole(blockedRole, playerEosID) {
    const player = await this.server.getPlayerByEOSID(playerEosID);

    // Вторая проверка текущей роли перед самим киком из отряда
    if (this.checkRole(player.role, blockedRole.roleRegex)) {
      await this.server.rcon.warn(
        playerEosID,
        `Данная роль (${blockedRole.description}) заблокирована до ${blockedRole.timePlayed} часов игры!`
      );
      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);

      this.verbose(
        1,
        `Игрок ${player.eosID} был удален из отряда за кит ${blockedRole.description}`
      );
    }
  }

  async removePlayerFromSquadForSquadLeader(playerEosID) {
    const player = await this.server.getPlayerByEOSID(playerEosID);

    // Вторая проверка наличия isLeader перед киком из отряда
    if (player.isLeader) {
      await this.server.rcon.warn(
        playerEosID,
        `Запрещено быть сквадным до ${this.options.banned_squad_leader_playtime} часов игры!`
      );
      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);

      this.verbose(1, `Игрок ${player.eosID} был удален за то, что был сквадным`);
    }
  }

  async updatePlayerPlaytime(steamID) {
    let playerEosID = await this.server.getPlayerBySteamID(steamID);
    playerEosID = playerEosID.eosID;

    let response;
    try {
      response = await this.steamUserInfoAPI({
        params: {
          steamid: steamID
        }
      });
    } catch (error) {
      this.verbose(1, `Ошибка во время получения времени пользователя ${error}`);
      this.verbose(
        1,
        `Игроку ${playerEosID} установлено время в ${TIME_IS_UNKNOWN} потому, что запрос его времени обернулся ошибкой`
      );

      this.playersTimes.set(playerEosID, TIME_IS_UNKNOWN);

      return;
    }

    const data = await response.data;
    const playerGames = data.response?.games;

    if (playerGames === undefined) {
      this.playersTimes.set(playerEosID, TIME_IS_UNKNOWN);
      this.verbose(
        1,
        `Игроку ${playerEosID} установлено время в ${TIME_IS_UNKNOWN} потому, что ответ на запрос его игр вышел пустой`
      );
      return;
    }

    let squadGamePlaytime = playerGames.find(
      (item) => item.appid === SQUAD_STEAM_ID
    )?.playtime_forever;

    if (squadGamePlaytime === undefined) {
      this.playersTimes.set(playerEosID, TIME_IS_UNKNOWN);
      this.verbose(
        1,
        `Игроку ${playerEosID} установлено время в ${TIME_IS_UNKNOWN} потому, что игра на его аккаунте не найдена`
      );
      return;
    }

    // Если у игрока открыто получение игр, но закрыто его время в игре - оно обозначено как 0, для нас это фактически - неизвестно
    if (squadGamePlaytime === 0) {
      this.playersTimes.set(playerEosID, TIME_IS_UNKNOWN);
      this.verbose(
        1,
        `Игроку ${playerEosID} установлено время в ${TIME_IS_UNKNOWN}, потому что его минуты в игре == 0`
      );
      return;
    }

    squadGamePlaytime = squadGamePlaytime / 60;

    this.playersTimes.set(playerEosID, squadGamePlaytime);
    this.verbose(1, `Игроку ${playerEosID}, установлено время в ${squadGamePlaytime} часов`);
  }

  async updatePlaytimeOfPlayers(players) {
    this.verbose(1, `Обновление времени в игре у ${players.length} игроков`);

    for (const index in players) {
      await this.updatePlayerPlaytime(players[index].steamID);
    }

    this.verbose(1, 'Обновление времени у списка пользователей завершено');
  }

  async showUserPlaytime(eosID) {
    const playerTime = this.getPlayerPlaytime(eosID);

    if (playerTime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(eosID, `Мы не смогли получить ваше время в игре Squad`);
      setTimeout(
        () =>
          this.server.rcon.warn(
            eosID,
            'Возможно у вас закрытый профиль в Steam, откройте его и мы сможем разрешить вам роли'
          ),
        3000
      );
    } else {
      await this.server.rcon.warn(eosID, `Ваши часы в игре: ${playerTime}`);
    }
  }

  async showUserBlockedRoles(eosID) {
    const playerPlaytime = this.getPlayerPlaytime(eosID);

    const blockedRoles = this.getBlockedRoles(playerPlaytime);
    if (blockedRoles.length === 0) {
      await this.server.rcon.warn(eosID, 'Все роли для вас открыты');
      return;
    }

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(
        eosID,
        'Мы не знаем ваше время игры, откройте его в настройках приватности Steam'
      );
    } else {
      await this.server.rcon.warn(eosID, `Ваше время в игре - ${playerPlaytime} часов`);
    }

    for (const index in blockedRoles) {
      await this.server.rcon.warn(
        eosID,
        `Заблокирована роль: ${blockedRoles[index].description} до ${blockedRoles[index].timePlayed} часов`
      );
    }
  }

  getBlockedRoles(playtime) {
    return this.options.banned_roles.filter(({ timePlayed }) => playtime < timePlayed);
  }

  searchRoleInList(role, listRoles) {
    return listRoles.find(({ roleRegex }) => this.checkRole(role, roleRegex));
  }

  checkRole(roleName, roleRegex) {
    return roleName.match(roleRegex);
  }

  getPlayerPlaytime(eosID) {
    const playtime = this.playersTimes.get(eosID);

    if (playtime === undefined) {
      this.verbose(1, `Запрошен ${eosID} время которого не было получено ранее`);
    }

    return playtime || TIME_IS_UNKNOWN;
  }
}
