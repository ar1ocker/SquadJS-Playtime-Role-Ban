//@ts-check
import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";
import y18n from "y18n";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
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

      blocked_infantry: {
        required: false,
        description: "The list of roles that should be blocked",
        example: [
          {
            role_regex: ".*Pilot.*", // Regex on role name
            // The amount of time in hours until which the role will be banned
            playtime_options: [
              { min_total_server_playtime: 80000, min_player_playtime: 1500 },
              { min_total_server_playtime: 100000, min_player_playtime: 2000 },
            ],
            description: "Helicopter pilot", // The description of the role that is displayed to the user
            instant_remove: false, // optional
          },
        ],
      },

      blocked_leader_playtime_options: {
        required: false,
        description: "Up to how many hours is the role of squad leader banned",
        example: [
          { min_total_server_playtime: 80000, min_player_playtime: 1500 },
          { min_total_server_playtime: 100000, min_total_playtime: 2000 },
        ],
      },
      blocked_cmd_playtime_options: {
        required: false,
        description: "Up to how many hours is the role of cmd banned",
        example: [
          { min_total_server_playtime: 80000, min_player_playtime: 1500 },
          { min_total_server_playtime: 100000, min_total_playtime: 2000 },
        ],
      },
      is_leader_blocked: {
        required: false,
        description: "Is the role of squad leader banned",
        default: false,
      },
      is_cmd_blocked: {
        required: false,
        description: "Is the role of cmd banned",
        default: false,
      },

      whitelisted_players: {
        required: false,
        description: "The list of players who ignore the rules of the plugin",
        default: [],
      },

      min_number_of_players_for_work: {
        required: false,
        description: "After how many players does whale blocking start working",
        default: 60,
      },

      whether_work_on_seed: {
        required: false,
        description: "Whether to work on seed",
        default: false,
      },

      whether_to_remove_a_player_from_squad: {
        required: false,
        description: "Whether to remove a player from a squad due to banned roles",
        default: true,
      },
      delay_before_remove_player_from_squad: {
        required: false,
        description: "How long does it take to remove a player from the squad for a blocked role, in seconds",
        default: 10,
      },

      whether_to_rename_squad: {
        required: false,
        description: "Whether to rename squad when squad leader has small playtime",
        default: true,
      },
      whether_to_instant_disband_new_squad: {
        required: false,
        description: "Will the new squad be instantly disbanded if its creator has small playtime",
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

      update_playtime_commands: {
        required: false,
        description: "The command to update the player`s time",
        default: ["update", "обновить", "updait", "updata"],
      },
      show_blocked_roles_commands: {
        required: false,
        description: "Command to show blocked roles",
        default: ["blocked", "блокировки", "блоки"],
      },
      show_all_current_blocked_roles_commands: {
        required: false,
        description: "Command to show all current blocked roles",
        default: ["allblocked", "всеблоки"],
      },

      frequency_leaders_check: {
        required: false,
        description: "The time between squad leaders and cmd checks",
        default: 20,
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.locale = y18n({
      locale: this.options.language,
      directory: "./squad-server/plugins/playtime-role-ban-locales",
    }).__;

    this.currentTotalServerPlaytime = 0;

    this.blockedCMD = new BlockedCMDRole(this.locale`CMD`);
    if (this.options.is_cmd_blocked) {
      for (const playtimeOption of this.options.blocked_cmd_playtime_options) {
        this.blockedCMD.addPlaytimesOptions(
          playtimeOption.min_total_server_playtime,
          playtimeOption.min_player_playtime
        );
      }
    }

    this.blockedLeader = new BlockedLeaderRole(this.locale`Leader`);
    if (this.options.is_leader_blocked) {
      for (const playtimeOption of this.options.blocked_leader_playtime_options) {
        this.blockedLeader.addPlaytimesOptions(
          playtimeOption.min_total_server_playtime,
          playtimeOption.min_player_playtime
        );
      }
    }

    this.blockedInfantryRoles = [];

    for (const role of this.options.blocked_infantry) {
      const instantRemove = Boolean(role.instant_remove);

      let blockObj = new BlockedInfantryRole(role.description, instantRemove, role.role_regex);
      for (const playtimeOption of role.playtime_options) {
        blockObj.addPlaytimesOptions(playtimeOption.min_total_server_playtime, playtimeOption.min_player_playtime);
      }

      this.blockedInfantryRoles.push(blockObj);
    }

    this.roleVerifyLock = new SoftLocking();
    this.leaderVerifyLock = new SoftLocking();
    this.newSquadLock = new SoftLocking();

    this.playtimeAPI = new PlaytimeSearcher(this.options.steam_api_key);

    this.showUserPlaytime = this.showUserPlaytime.bind(this);
    this.verifyPlayerRole = this.verifyPlayerRole.bind(this);
    this.verifyPlayerSquadLeader = this.verifyPlayerSquadLeader.bind(this);
    this.verifyPlayerCMD = this.verifyPlayerCMD.bind(this);
    this.removePlayerFromSquadForRole = this.removePlayerFromSquadForRole.bind(this);
    this.removePlayerFromSquadForSquadLeader = this.removePlayerFromSquadForSquadLeader.bind(this);
    this.showUserBlockedRoles = this.showUserBlockedRoles.bind(this);
    this.getPlayerPlaytime = this.getPlayerPlaytime.bind(this);
    this.warn = this.warn.bind(this);
    this.warns = this.warns.bind(this);
    this.warnUserAboutUnknownPlaytime = this.warnUserAboutUnknownPlaytime.bind(this);
  }

  async mount() {
    this.readLastParams();

    this.selectBlockedPlaytimeOptions();
    this.mountCommands();
    this.mountPlayerConnectedActions();
    this.mountPlayerRoleVeryfy();
    this.mountLeaderVerify();
    this.enablePeriodicallyLeadersVerify();

    this.server.on("ROUND_ENDED", async () => {
      this.currentTotalServerPlaytime = await this.getTotalServerPlaytime();
      this.selectBlockedPlaytimeOptions();
      this.saveLastParams();
      this.verbose(2, `Current total server playtime ${this.currentTotalServerPlaytime}`);
    });

    this.verbose(1, this.locale`Plugin has been installed`);
  }

  enablePeriodicallyLeadersVerify() {
    setInterval(async () => {
      if (!(this.isNeedToCheck() && this.options.is_leader_blocked)) {
        return;
      }

      for (const player of this.server.players) {
        if (!player) {
          continue;
        }

        if (player.isLeader) {
          if (
            !this.newSquadLock.isLock(`${player.squadID}${player.teamID}`) &&
            !this.leaderVerifyLock.isLock(player.steamID)
          ) {
            this.leaderVerifyLock.lock(player.steamID);
            await this.verifyPlayerSquadLeader(player);

            await this.leaderVerifyLock.unlockWithWait(player.steamID);
          }
        }
      }
    }, this.options.frequency_leaders_check * 1000);

    setInterval(async () => {
      if (!(this.isNeedToCheck() && this.options.is_cmd_blocked)) {
        return;
      }

      for (const squad of this.server.squads) {
        const player = this.server.players.find(
          (player) => player.teamID === squad.teamID && player.squadID === squad.squadID
        );

        if (player && player.squad) {
          await this.verifyPlayerCMD(player);
        }
      }
    }, this.options.frequency_leaders_check * 1000);
  }

  mountCommands() {
    for (const command of this.options.update_playtime_commands) {
      this.server.on(`CHAT_COMMAND:${command.toLowerCase()}`, async (data) => {
        if (data.player?.steamID) {
          await this.getPlayerPlaytime(data.player.steamID, true);
          await this.showUserPlaytime(data.player.steamID);
        }
      });
    }

    for (const command of this.options.show_blocked_roles_commands) {
      this.server.on(`CHAT_COMMAND:${command.toLowerCase()}`, async (data) => {
        if (data.player?.steamID) {
          await this.getPlayerPlaytime(data.player.steamID, true);
          await this.showUserBlockedRoles(data.player.steamID);
        }
      });
    }

    for (const command of this.options.show_all_current_blocked_roles_commands) {
      this.server.on(`CHAT_COMMAND:${command.toLowerCase()}`, (data) => {
        if (data.player?.steamID) {
          this.showAllCurrentBlockedRoles(data.player.steamID);
        }
      });
    }
  }

  mountPlayerConnectedActions() {
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
        if (this.isNeedToCheck() && data.player) {
          setTimeout(
            () => this.showUserBlockedRoles(data.player.steamID),
            this.options.delay_to_show_blocked_roles_on_connected * 1000
          );
        }
      });
    }
  }

  mountPlayerRoleVeryfy() {
    this.server.on("PLAYER_ROLE_CHANGE", async (data) => {
      if (this.isNeedToCheck() && data.player) {
        if (this.roleVerifyLock.lock(`${data.player.steamID}${data.player.role}`)) {
          await this.verifyPlayerRole(data.player);

          await this.roleVerifyLock.unlockWithWait(`${data.player.steamID}${data.player.role}`);
        }
      }
    });

    this.server.on("PLAYER_POSSESS", async (data) => {
      if (this.isNeedToCheck() && data.player) {
        if (this.roleVerifyLock.lock(`${data.player.steamID}${data.player.role}`)) {
          await this.verifyPlayerRole(data.player);

          await this.roleVerifyLock.unlockWithWait(`${data.player.steamID}${data.player.role}`);
        }
      }
    });
  }

  mountLeaderVerify() {
    this.server.on("PLAYER_NOW_IS_LEADER", async (data) => {
      if (this.isNeedToCheck() && this.options.is_leader_blocked && data.player) {
        // т.к. PLAYER_NOW_IS_LEADER и SQUAD_CREATED приходят в одно время, а время создания сквада мы не знаем - этот костыль позволяет первоначально проверять SQUAD_CREATED, а потом уже PLAYER_NOW_IS_LEADER
        await new Promise((resolve) => setTimeout(resolve, 300));
        data.player = await this.server.getPlayerBySteamID(data.player.steamID);
        if (
          data.player &&
          !this.newSquadLock.isLock(`${data.player.squadID}${data.player.teamID}`) &&
          !this.leaderVerifyLock.isLock(data.player.steamID) &&
          data.player?.isLeader
        ) {
          this.leaderVerifyLock.lock(data.player.steamID);

          await this.verifyPlayerSquadLeader(data.player);

          await this.leaderVerifyLock.unlockWithWait(data.player.steamID);
        }
      }
    });

    if (this.options.whether_to_instant_disband_new_squad) {
      this.server.on("SQUAD_CREATED", async (data) => {
        this.verbose(
          2,
          this
            .locale`Squad created player ${String(data.player?.steamID)}, squad ID ${data.squadID}, teamID ${data.teamName}, name ${data.squadName}`
        );

        if (this.isNeedToCheck() && this.options.is_leader_blocked && data.player) {
          this.newSquadLock.lock(`${data.squadID}${data.teamID}`);
          await this.verifyCreatedSquadLeader(data.player);
          this.newSquadLock.unlock(`${data.squadID}${data.teamID}`);
        }
      });
    }
  }

  async verifyPlayerRole(player) {
    if (this.isIDWhitelisted(player.steamID)) {
      return;
    }

    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    let blockedRole = null;

    for (const _blockedRole of this.blockedInfantryRoles) {
      if (!_blockedRole.isPlayerValid(player, playerPlaytime)) {
        blockedRole = _blockedRole;
        break;
      }
    }

    if (!blockedRole) {
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

    if (!this.options.whether_to_remove_a_player_from_squad) {
      await this.warn(
        player.steamID,
        this
          .locale`Role (${blockedRole.description}) is blocked until ${blockedRole.selectedBlockOption?.minPlayerPlaytime} playtime, TAKE ANOTHER ONE.`,
        this.options.count_of_ban_role_messages,
        this.options.frequency_of_ban_role_messages
      );

      return;
    }

    if (blockedRole.instantRemove) {
      await this.removePlayerFromSquadForRole(blockedRole, player.steamID);
    } else {
      this.warn(
        player.steamID,
        this
          .locale`Role (${blockedRole.description}) is blocked until ${blockedRole.selectedBlockOption?.minPlayerPlaytime} playtime, TAKE ANOTHER ONE. ${this.options.delay_before_remove_player_from_squad} seconds.`,
        this.options.count_of_ban_role_messages,
        this.options.frequency_of_ban_role_messages
      );

      await new Promise((resolve) =>
        setTimeout(async () => {
          await this.removePlayerFromSquadForRole(blockedRole, player.steamID);
          resolve(null);
        }, this.options.delay_before_remove_player_from_squad * 1000)
      );
    }

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warnUserAboutUnknownPlaytime(player.steamID);
    }
  }

  async verifyPlayerSquadLeader(player) {
    if (this.isIDWhitelisted(player.steamID)) {
      return;
    }

    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    if (this.blockedLeader.isPlayerValid(player, playerPlaytime)) {
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

    const updatedPlayer = this.server.getPlayerBySteamID(player.steamID);

    if (this.options.whether_to_rename_squad) {
      if (updatedPlayer.isLeader && !updatedPlayer.squad?.squadName.startsWith("Squad")) {
        await this.server.rcon.execute(`AdminRenameSquad ${updatedPlayer.teamID} ${updatedPlayer.squadID}`);
        this.verbose(
          1,
          this
            .locale`Squad with leader ${updatedPlayer.steamID}, name ${updatedPlayer.squad?.squadName} and teamID ${updatedPlayer.teamID} has been renamed`
        );
      }
    }

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warnUserAboutUnknownPlaytime(player.steamID);
    }

    if (!this.options.whether_to_remove_a_player_from_squad) {
      await this.warn(
        player.steamID,
        this
          .locale`You are banned from being a squad leader until ${this.blockedLeader.selectedBlockOption?.minPlayerPlaytime} playtime, DISBAND the squad or TRANSFER the role!`,
        this.options.count_of_ban_role_messages,
        this.options.frequency_of_ban_role_messages
      );

      return;
    }

    this.warn(
      player.steamID,
      this
        .locale`You are banned from being a squad leader until ${this.blockedLeader.selectedBlockOption?.minPlayerPlaytime} playtime, DISBAND the squad or TRANSFER the role! ${this.options.delay_before_remove_player_from_squad} seconds.`,
      this.options.count_of_ban_role_messages,
      this.options.frequency_of_ban_role_messages
    );

    await new Promise((resolve) =>
      setTimeout(async () => {
        await this.removePlayerFromSquadForSquadLeader(player.steamID);
        resolve(null);
      }, this.options.delay_before_remove_player_from_squad * 1000)
    );
  }

  async verifyCreatedSquadLeader(player) {
    if (this.isIDWhitelisted(player.steamID)) {
      return;
    }

    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    const updatedPlayer = await this.server.getPlayerBySteamID(player.steamID);

    // Дополнительная проверка что создаваший сквад человек до сих пор в нём находится, но без проверки isLeader, т.к. нам по сути всё равно был ли передан сл
    if (
      !this.blockedLeader.isPlaytimeValid(playerPlaytime) &&
      updatedPlayer &&
      updatedPlayer.squadID === player.squadID &&
      updatedPlayer.teamID === player.teamID
    ) {
      this.verbose(
        1,
        this
          .locale`Squad ${updatedPlayer.squadID} with name ${String(updatedPlayer.squad?.squadName)} from team number ${updatedPlayer.teamID} has been disbanded, squad creator steam id ${updatedPlayer.steamID}, playtime ${playerPlaytime}`
      );

      await this.server.rcon.execute(`AdminDisbandSquad ${updatedPlayer.teamID} ${updatedPlayer.squadID}`);
      updatedPlayer.isLeader = false;

      await this.warn(
        updatedPlayer.steamID,
        this
          .locale`You are banned from being a squad leader until ${this.blockedLeader.selectedBlockOption?.minPlayerPlaytime} playtime`
      );

      if (playerPlaytime === TIME_IS_UNKNOWN) {
        await this.warnUserAboutUnknownPlaytime(updatedPlayer.steamID);
      }

      return;
    }

    this.verbose(
      1,
      this
        .locale`Detected as squad leader ${player.steamID} with ${playerPlaytime} hours of playtime, squad role is allowed for him for playtime`
    );
  }

  async verifyPlayerCMD(player) {
    if (this.isIDWhitelisted(player.steamID)) {
      return;
    }

    const playerPlaytime = await this.getPlayerPlaytime(player.steamID);

    if (this.blockedCMD.isPlayerValid(player, playerPlaytime)) {
      this.verbose(
        1,
        this
          .locale`Detected cmd ${player.steamID} with ${playerPlaytime} hours, cmd role is allowed for him for playtime`
      );
    }

    await this.server.rcon.execute(`AdminDemoteCommander ${player.eosID}`);

    await this.warn(
      player.steamID,
      this
        .locale`You are banned from being a CMD until ${this.blockedCMD.selectedBlockOption?.minPlayerPlaytime} playtime`,
      3
    );

    this.verbose(1, this.locale`CMD ${player.steamID} with ${playerPlaytime} hours has been demoted from commander`);
  }

  /**
   *
   * @param {BlockedInfantryRole} blockedRole
   * @param {string} playerSteamID
   * @returns
   */
  async removePlayerFromSquadForRole(blockedRole, playerSteamID) {
    const player = await this.server.getPlayerBySteamID(playerSteamID);

    if (!player) {
      return;
    }

    // Вторая проверка текущей роли перед самим киком из отряда
    if (blockedRole.isRoleMatch(player.role)) {
      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);

      this.warn(
        playerSteamID,
        this
          .locale`This role (${blockedRole.description}) is blocked until ${blockedRole.selectedBlockOption?.minPlayerPlaytime} hours of playtime!`
      );

      this.verbose(
        1,
        this.locale`Player ${player.steamID} was removed from the squad for the ${blockedRole.description} role`
      );
    } else {
      this.warn(playerSteamID, this.locale`Thanks!`);
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
          .locale`It is forbidden to be a squad leader until ${this.blockedLeader.selectedBlockOption?.minPlayerPlaytime} hours of playtime!`
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
      await this.warnUserAboutUnknownPlaytime(playerSteamID);
    } else {
      await this.warn(playerSteamID, this.locale`Your playtime is ${playerPlaytime.toFixed(0)} hours`);
    }
  }

  async showAllCurrentBlockedRoles(playerSteamID) {
    const allRoles = [this.blockedCMD, this.blockedLeader].concat(this.blockedInfantryRoles);

    let blockedRolesMessages = [];

    for (const blockedRole of allRoles) {
      if (blockedRole.selectedBlockOption) {
        blockedRolesMessages.push(
          this
            .locale`Role blocked: ${blockedRole.description} up to ${blockedRole.selectedBlockOption?.minPlayerPlaytime} hours`
        );
      }
    }

    blockedRolesMessages.push(
      this.locale`Last saved total server playtime: ${this.currentTotalServerPlaytime.toFixed(0)} hours`
    );

    await this.warns(playerSteamID, blockedRolesMessages, this.options.frequency_of_info_ban_roles_messages);
  }

  async showUserBlockedRoles(playerSteamID) {
    if (this.isIDWhitelisted(playerSteamID)) {
      await this.warn(playerSteamID, this.locale`All roles are open for you`);
      return;
    }

    const playerPlaytime = await this.getPlayerPlaytime(playerSteamID);

    let blockedRoles = [];

    if (!this.blockedCMD.isPlaytimeValid(playerPlaytime)) {
      blockedRoles.push(this.blockedCMD);
    }

    if (!this.blockedLeader.isPlaytimeValid(playerPlaytime)) {
      blockedRoles.push(this.blockedLeader);
    }

    blockedRoles = blockedRoles.concat(this.getBlockedInfantryRolesByPlaytime(playerPlaytime));

    if (blockedRoles.length === 0) {
      await this.warn(playerSteamID, this.locale`All roles are open for you`);
      return;
    }

    let blockedRolesMessages = [];

    for (const blockedRole of blockedRoles) {
      blockedRolesMessages.push(
        this
          .locale`Role blocked: ${blockedRole.description} up to ${blockedRole.selectedBlockOption?.minPlayerPlaytime} hours`
      );
    }

    await this.warns(playerSteamID, blockedRolesMessages, this.options.frequency_of_info_ban_roles_messages);

    await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.warnUserAboutUnknownPlaytime(playerSteamID);
    } else {
      await this.warn(playerSteamID, this.locale`Your playtime is ${playerPlaytime.toFixed(0)} hours`);
    }
  }

  selectBlockedPlaytimeOptions() {
    for (const blockedRole of this.blockedInfantryRoles) {
      blockedRole.selectBlockOptionByPlaytime(this.currentTotalServerPlaytime);
    }

    this.blockedLeader?.selectBlockOptionByPlaytime(this.currentTotalServerPlaytime);

    this.blockedCMD?.selectBlockOptionByPlaytime(this.currentTotalServerPlaytime);
  }

  getBlockedInfantryRolesByPlaytime(playtime) {
    return this.blockedInfantryRoles.filter((blockedRole) => !blockedRole.isPlaytimeValid(playtime));
  }

  isNeedToCheck() {
    let gamemode_pass = true;

    if (!this.options.whether_work_on_seed) {
      const gamemode = this.server.currentLayer?.gamemode;
      gamemode_pass = gamemode !== "Seed";
    }

    return this.server.players.length >= this.options.min_number_of_players_for_work && gamemode_pass;
  }

  /**
   *
   * @param {string} id
   * @returns
   */
  isIDWhitelisted(id) {
    return this.options.whitelisted_players.includes(id);
  }

  async getPlayerPlaytime(steamID, ignoreCache = false) {
    const playtimeObject = await this.playtimeAPI.getPlaytimeByGame(steamID, SQUAD_GAME_ID, ignoreCache);

    if (playtimeObject.errors.length > 0) {
      this.verbose(1, this.locale`Requested ${steamID} with errors ${playtimeObject.errors.join(", ")}`);
    }

    return playtimeObject.playtime;
  }

  async getTotalServerPlaytime() {
    let playtimes = await Promise.all(
      this.server.players.map(async (player) => {
        const playtime = await this.getPlayerPlaytime(player.steamID);

        if (playtime === TIME_IS_UNKNOWN) {
          return 0;
        }

        return playtime;
      })
    );

    return playtimes.reduce((prev, curr) => prev + curr);
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

  async warnUserAboutUnknownPlaytime(playerID) {
    await this.warn(
      playerID,
      this.locale`Your playtime is unknown! Open your Steam profile so that we can allow you to play roles.`,
      this.options.count_of_unknown_playtime_messages,
      this.options.frequency_of_unknown_playtime_messages
    );
  }

  readLastParams() {
    const configPath = path.join(DIRNAME, "configs", "playtime-role-ban.json");
    if (fs.existsSync(configPath)) {
      const file = fs.readFileSync(configPath, { encoding: "utf-8" });

      let config;
      try {
        config = JSON.parse(file);
      } catch (err) {
        this.verbose(1, "Unable to load config");
        throw err;
      }

      this.currentTotalServerPlaytime = config.last_total_server_playtime;
      return;
    }

    try {
      fs.mkdirSync(path.join(DIRNAME, "configs"));
      this.saveLastParams();
    } catch (err) {
      this.verbose(1, "Unable to create config directory");
      throw err;
    }
  }

  saveLastParams() {
    const configPath = path.join(DIRNAME, "configs", "playtime-role-ban.json");
    const config = JSON.stringify({ last_total_server_playtime: this.currentTotalServerPlaytime }, null, "  ");

    fs.writeFileSync(configPath, config);
  }
}

class BlockOption {
  /**
   *
   * @param {number} minTotalPlaytime
   * @param {number} minPlayerPlaytime
   */
  constructor(minTotalPlaytime, minPlayerPlaytime) {
    this.minTotalPlaytime = minTotalPlaytime;
    this.minPlayerPlaytime = minPlayerPlaytime;
  }
}

class BlockedRoleAbstract {
  constructor(description) {
    this.description = description;

    /**
     * @type {Array<BlockOption>}
     */
    this.blockOptions = new Array();

    /**
     * @type {BlockOption|null}
     */
    this.selectedBlockOption = null;
  }

  addPlaytimesOptions(minTotalPlaytime, minPlayerPlaytime) {
    this.blockOptions.push(new BlockOption(minTotalPlaytime, minPlayerPlaytime));
  }

  selectBlockOptionByPlaytime(totalPlaytime) {
    let blockOptionsSorted = this.blockOptions.sort((a, b) => b.minTotalPlaytime - a.minTotalPlaytime);
    // Find the block option that has a total playtime greater than or equal to the current total playtime
    for (const blockOption of blockOptionsSorted) {
      if (totalPlaytime >= blockOption.minTotalPlaytime) {
        this.selectedBlockOption = blockOption;
        return;
      }
    }

    this.selectedBlockOption = null;
  }

  isPlaytimeValid(playtime) {
    if (!this.selectedBlockOption) {
      return true;
    }

    if (playtime > this.selectedBlockOption.minPlayerPlaytime) {
      return true;
    }

    return false;
  }

  /**
   *
   * @param {object} player
   * @param {number} playerPlaytime
   */
  // eslint-disable-next-line no-unused-vars
  isPlayerValid(player, playerPlaytime) {}
}

class BlockedCMDRole extends BlockedRoleAbstract {
  /**
   *
   * @param {object} player
   * @param {number} playerPlaytime
   */
  isPlayerValid(player, playerPlaytime) {
    if (!this.selectedBlockOption) {
      return true;
    }

    if (
      player.isLeader &&
      player.squad?.squadName === "Command Squad" &&
      this.selectedBlockOption.minPlayerPlaytime > playerPlaytime
    ) {
      return false;
    }

    return true;
  }
}

class BlockedLeaderRole extends BlockedRoleAbstract {
  /**
   *
   * @param {object} player
   * @param {number} playerPlaytime
   */
  isPlayerValid(player, playerPlaytime) {
    if (!this.selectedBlockOption) {
      return true;
    }

    if (player.isLeader && this.selectedBlockOption?.minPlayerPlaytime > playerPlaytime) {
      return false;
    }

    return true;
  }
}

class BlockedInfantryRole extends BlockedRoleAbstract {
  constructor(description, instantRemove, regex) {
    super(description);
    this.instantRemove = instantRemove;
    this.regex = regex;
  }

  /**
   *
   * @param {object} player
   * @param {number} playerPlaytime
   */
  isPlayerValid(player, playerPlaytime) {
    if (!this.selectedBlockOption) {
      return true;
    }

    if (this.selectedBlockOption?.minPlayerPlaytime > playerPlaytime && player.role.match(this.regex)) {
      return false;
    }

    return true;
  }

  /**
   *
   * @param {string} role
   * @returns
   */
  isRoleMatch(role) {
    return role.match(this.regex) ? true : false;
  }
}

class SoftLocking {
  constructor() {
    this.lockingNames = new Set();

    this.lock = this.lock.bind(this);
    this.unlock = this.unlock.bind(this);
    this.unlockAll = this.unlockAll.bind(this);
    this.unlockWithWait = this.unlockWithWait.bind(this);
    this.isLock = this.isLock.bind(this);
  }

  async unlockWithWait(name, timeout = 1) {
    await new Promise((resolve) =>
      setTimeout(() => {
        this.unlock(name);
        resolve(null);
      }, timeout * 1000)
    );
  }

  lock(name) {
    if (this.lockingNames.has(name)) {
      return false;
    }

    this.lockingNames.add(name);
    return true;
  }

  unlock(name) {
    if (!this.lockingNames.has(name)) {
      return false;
    }

    this.lockingNames.delete(name);
    return true;
  }

  unlockAll() {
    this.lockingNames.clear();
  }

  isLock(name) {
    return this.lockingNames.has(name);
  }
}
