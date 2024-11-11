import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";
import y18n from "y18n";

const SQUAD_GAME_ID = 393380;

export default class PlaytimeRoleBan extends BasePlugin {
  static get description() {
    return "Removes player from squad due to time played";
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      language: {
        required: false,
        description: "Locale",
        default: "en",
      },
      steam_api_key: {
        required: true,
        description: "The API key from the steam user account, which will be used to search for the user`s game time",
        default: "",
      },
      banned_roles: {
        required: true,
        description: "The list of roles that should be banned",
        default: [
          {
            roleRegex: ".*Pilot.*", // Regex on role name
            timePlayed: 1500, // The amount of time in hours until which the role will be banned
            description: "Helicopter pilot", // The description of the role that is displayed to the user
          },
        ],
      },
      banned_squad_leader_playtime: {
        required: true,
        description: "Up to how many hours is the role of the squad leader banned",
        default: 100,
      },
      whether_to_remove_a_player_from_squad: {
        required: false,
        description: "Whethener to remove a player from a squad due to banned roles",
        default: true,
      },
      min_number_of_players_for_work: {
        required: true,
        description: "After how many players does whale blocking start working",
        default: 60,
      },
      is_squad_leader_banned: {
        required: false,
        description: "Is the role of the squad leader banned",
        default: true,
      },
      show_users_their_blocked_roles: {
        required: false,
        description: "Whether to show the blocked roles to the user when logging in to the server",
        default: true,
      },
      delay_to_show_blocked_roles_on_connected: {
        required: false,
        description: "The delay before showing the user his blocked roles",
        default: 20,
      },
      show_users_their_time_on_connected: {
        required: false,
        description: "Whether to show users their time when logging in to the server",
        default: true,
      },
      delay_to_show_time_on_connected: {
        required: false,
        description: "The delay before showing the time when logging in to the server, in seconds",
        default: 10,
      },
      delay_before_remove_player_from_squad: {
        required: false,
        description: "How long does it take to remove a player from the squad for a blocked role, in seconds",
        default: 10,
      },
      count_of_unknown_playtime_messages: {
        required: false,
        description: "The number of messages displayed about an unknown playtime",
        default: 2,
      },
      frequency_of_unknown_playtime_messages: {
        required: false,
        description: "The time between messages about an unknown playtime",
        default: 5,
      },
      count_of_ban_role_messages: {
        required: false,
        description: "The number of messages displayed about an ban role",
        default: 3,
      },
      frequency_of_ban_role_messages: {
        required: false,
        description: "The time between messages about an ban role",
        default: 2,
      },
      frequency_of_info_ban_roles_messages: {
        required: false,
        description: "The time between messages with information about banned roles",
        default: 5,
      },
      frequency_leaders_check: {
        required: false,
        description: "The time between squad leaders checks",
        default: 20,
      },
      update_playtime_command: {
        required: false,
        description: "The command to update the player`s time",
        default: "update",
      },
      show_blocked_roles_command: {
        required: false,
        description: "Command to show blocked roles",
        default: "blocked",
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.locale = y18n({
      locale: this.options.language,
      directory: "./squad-server/plugins/playtime-role-ban-locales",
    }).__;

    this.playtimeAPI = new PlaytimeSearcher(this.options.steam_api_key);

    this.showUserPlaytime = this.showUserPlaytime.bind(this);
    this.verifyPlayerRole = this.verifyPlayerRole.bind(this);
    this.verifyPlayerSquadLeader = this.verifyPlayerSquadLeader.bind(this);
    this.removePlayerFromSquadForRole = this.removePlayerFromSquadForRole.bind(this);
    this.removePlayerFromSquadForSquadLeader = this.removePlayerFromSquadForSquadLeader.bind(this);
    this.showUserBlockedRoles = this.showUserBlockedRoles.bind(this);
    this.getPlayerPlaytime = this.getPlayerPlaytime.bind(this);
    this.warn = this.warn.bind(this);
    this.warns = this.warns.bind(this);
    this.warn_user_about_unknown_playtime = this.warn_user_about_unknown_playtime.bind(this);
  }

  async mount() {
    this.server.on(`CHAT_COMMAND:${this.options.update_playtime_command.toLowerCase()}`, async (data) => {
      if (data.player) {
        await this.getPlayerPlaytime(data.player.steamID, true);
        await this.showUserPlaytime(data.player.steamID);
      }
    });

    this.server.on(`CHAT_COMMAND:${this.options.show_blocked_roles_command.toLowerCase()}`, async (data) => {
      if (data.player) {
        await this.getPlayerPlaytime(data.player.steamID, true);
        await this.showUserBlockedRoles(data.player.steamID);
      }
    });

    this.server.on("PLAYER_CONNECTED", async (data) => {
      if (data.player) {
        await this.getPlayerPlaytime(data.player.steamID, true);
      }
    });

    if (this.options.show_users_their_time_on_connected) {
      this.server.on("PLAYER_CONNECTED", (data) => {
        if (data.player) {
          setTimeout(
            () => this.showUserPlaytime(data.player.steamID),
            this.options.delay_to_show_time_on_connected * 1000
          );
        }
      });
    }

    if (this.options.show_users_their_blocked_roles) {
      this.server.on("PLAYER_CONNECTED", (data) => {
        if (this.server.players.length >= this.options.min_number_of_players_for_work && data.player) {
          setTimeout(
            () => this.showUserBlockedRoles(data.player.steamID),
            this.options.delay_to_show_blocked_roles_on_connected * 1000
          );
        }
      });
    }

    this.server.on("PLAYER_ROLE_CHANGE", (data) => {
      if (this.server.players.length >= this.options.min_number_of_players_for_work && data.player) {
        this.verifyPlayerRole(data.player);
      }
    });

    this.server.on("PLAYER_POSSESS", (data) => {
      if (this.server.players.length >= this.options.min_number_of_players_for_work && data.player) {
        this.verifyPlayerRole(data.player);
      }
    });

    this.server.on("PLAYER_NOW_IS_LEADER", (data) => {
      if (this.server.players.length >= this.options.min_number_of_players_for_work && data.player) {
        this.verifyPlayerSquadLeader(data.player);
      }
    });

    setInterval(async () => {
      if (this.server.players.length < this.options.min_number_of_players_for_work) {
        return;
      }

      for (const player of this.server.players) {
        if (!player) {
          return;
        }

        if (player.isLeader) {
          await this.verifyPlayerSquadLeader(player);
        }
      }
    }, this.options.frequency_leaders_check * 1000);

    this.verbose(1, this.locale`Plugin has been installed`);
  }

  async verifyPlayerRole(player) {
    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    const allBlockedRoles = this.getBlockedRoles(playerPlaytime);

    if (allBlockedRoles.length === 0) {
      this.verbose(
        1,
        this
          .locale`Player ${player.steamID} has more playtime than all blocked roles: ${playerPlaytime} hours, plays the allowed role ${player.role}`
      );
      return;
    }

    const blockedRole = this.searchRoleInList(player.role, allBlockedRoles);

    if (blockedRole === undefined) {
      this.verbose(
        1,
        this.locale`Player ${player.steamID} with playtime ${playerPlaytime} plays the allowed role ${player.role}`
      );
      return;
    }

    this.verbose(
      1,
      this
        .locale`Player ${player.steamID} with playtime ${playerPlaytime} and role ${player.role} matching the ${blockedRole.description} filter has been detected, the process of removing him from the squad has been started`
    );

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warn_user_about_unknown_playtime(player.steamID);
    }

    if (!this.options.whether_to_remove_a_player_from_squad) {
      await this.warn(
        player.steamID,
        this
          .locale`Role (${blockedRole.description}) is blocked until ${blockedRole.timePlayed} playtime, TAKE ANOTHER ONE.`,
        this.options.count_of_ban_role_messages,
        this.options.frequency_of_ban_role_messages
      );

      return;
    }

    setTimeout(
      () => this.removePlayerFromSquadForRole(blockedRole, player.steamID),
      this.options.delay_before_remove_player_from_squad * 1000
    );

    await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

    await this.warn(
      player.steamID,
      this
        .locale`Role (${blockedRole.description}) is blocked until ${blockedRole.timePlayed} playtime, TAKE ANOTHER ONE. ${this.options.delay_before_remove_player_from_squad} seconds.`,
      this.options.count_of_ban_role_messages,
      this.options.frequency_of_ban_role_messages
    );
  }

  async verifyPlayerSquadLeader(player) {
    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    if (playerPlaytime > this.options.banned_squad_leader_playtime) {
      this.verbose(
        1,
        this
          .locale`Detected as squad leader ${player.steamID} with ${playerPlaytime} hours of playtime, squad role is allowed for him for playtime`
      );
      return;
    }

    this.verbose(
      1,
      this
        .locale`Squad leader ${player.steamID} with playtime ${playerPlaytime} hours has been detected, the process of removing him from the squad leader has been started`
    );

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warn_user_about_unknown_playtime(player.steamID);
    }

    if (!this.options.whether_to_remove_a_player_from_squad) {
      await this.warn(
        player.steamID,
        this
          .locale`You are banned from being a squad leader until ${this.options.banned_squad_leader_playtime} playtime, DISBAND the squad or TRANSFER the role!`,
        this.options.count_of_ban_role_messages,
        this.options.frequency_of_ban_role_messages
      );

      return;
    }

    setTimeout(
      () => this.removePlayerFromSquadForSquadLeader(player.steamID),
      this.options.delay_before_remove_player_from_squad * 1000
    );

    await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

    await this.warn(
      player.steamID,
      this
        .locale`You are banned from being a squad leader until ${this.options.banned_squad_leader_playtime} playtime, DISBAND the squad or TRANSFER the role! ${this.options.delay_before_remove_player_from_squad} seconds.`,
      this.options.count_of_ban_role_messages,
      this.options.frequency_of_ban_role_messages
    );
  }

  async removePlayerFromSquadForRole(blockedRole, playerSteamID) {
    const player = await this.server.getPlayerBySteamID(playerSteamID);

    if (!player) {
      return;
    }

    // Вторая проверка текущей роли перед самим киком из отряда
    if (this.checkRole(player.role, blockedRole.roleRegex)) {
      await this.warn(
        playerSteamID,
        this
          .locale`This role (${blockedRole.description}) is blocked until ${blockedRole.timePlayed} hours of playtime!`
      );

      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);

      this.verbose(
        1,
        this.locale`Player ${player.steamID} was removed from the squad for the ${blockedRole.description} role`
      );
    }
  }

  async removePlayerFromSquadForSquadLeader(playerSteamID) {
    const player = await this.server.getPlayerBySteamID(playerSteamID);

    if (!player) {
      return;
    }

    // Вторая проверка наличия isLeader перед киком из отряда
    if (player.isLeader) {
      await this.server.rcon.warn(
        playerSteamID,
        this
          .locale`It is forbidden to be a squad leader until ${this.options.banned_squad_leader_playtime} hours of playtime!`
      );
      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);

      this.verbose(1, this.locale`Player ${player.steamID} was removed for being a squad player`);
    } else {
      await this.warn(playerSteamID, this.locale`Thanks!`);
    }
  }

  async showUserPlaytime(playerSteamID) {
    const playerPlaytime = await this.getPlayerPlaytime(playerSteamID);

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warn_user_about_unknown_playtime(playerSteamID);
    } else {
      await this.warn(playerSteamID, this.locale`Your playtime is ${playerPlaytime.toFixed(0)} hours`);
    }
  }

  async showUserBlockedRoles(playerSteamID) {
    const playerPlaytime = await this.getPlayerPlaytime(playerSteamID);

    const blockedRoles = this.getBlockedRoles(playerPlaytime);

    if (blockedRoles.length === 0) {
      await this.warn(playerSteamID, this.locale`All roles are open for you`);
      return;
    }

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warn_user_about_unknown_playtime(playerSteamID);
    } else {
      await this.warn(playerSteamID, this.locale`Your playtime is ${playerPlaytime.toFixed(0)} hours`);
    }

    let blocked_roles_messages = [];

    if (this.options.is_squad_leader_banned && playerPlaytime < this.options.banned_squad_leader_playtime) {
      blocked_roles_messages.push(
        this.locale`Role blocked: Squad Leader up to ${this.options.banned_squad_leader_playtime} hours`
      );
    }

    for (const role of blockedRoles) {
      blocked_roles_messages.push(this.locale`Role blocked: ${role.description} up to ${role.timePlayed} hours`);
    }

    await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

    await this.warns(playerSteamID, blocked_roles_messages, this.options.frequency_of_info_ban_roles_messages);
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

  async getPlayerPlaytime(steamID, ignoreCache = false) {
    const playtimeObject = await this.playtimeAPI.getPlaytimeByGame(steamID, SQUAD_GAME_ID, ignoreCache);

    if (playtimeObject.errors.length > 0) {
      this.verbose(1, this.locale`Requested ${steamID} with errors ${playtimeObject.errors.join(", ")}`);
    }

    return playtimeObject.playtime;
  }

  async warn(playerID, message, repeat = 1, frequency = 5) {
    for (let i = 0; i < repeat; i++) {
      // repeat используется для того, чтобы squad выводил все сообщения, а не скрывал их из-за того, что они одинаковые
      await this.server.rcon.warn(playerID, message + "\u{00A0}".repeat(i));

      if (i !== repeat - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }

  async warns(playerID, messages, frequency = 5) {
    for (const [index, message] of messages.entries()) {
      await this.server.rcon.warn(playerID, message);

      if (index != messages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, frequency * 1000));
      }
    }
  }

  async warn_user_about_unknown_playtime(playerID) {
    await this.warn(
      playerID,
      this.locale`Your playtime is unknown! Open your Steam profile so that we can allow you to play roles.`,
      this.options.count_of_unknown_playtime_messages,
      this.options.frequency_of_unknown_playtime_messages
    );
  }
}
