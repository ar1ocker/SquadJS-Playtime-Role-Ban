import BasePlugin from "./base-plugin.js";
import axios from "axios";
import y18n from "y18n";

// A label in player_times that means that the user's time is unknown
const TIME_IS_UNKNOWN = -1;

const SQUAD_STEAM_ID = 393380;

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
        description:
          "The API key from the steam user account, which will be used to search for the user`s game time",
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
        description:
          "Up to how many hours is the role of the squad leader banned",
        default: 100,
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
        description:
          "Whether to show the blocked roles to the user when logging in to the server",
        default: true,
      },
      delay_to_show_blocked_roles_on_connected: {
        required: false,
        description: "The delay before showing the user his blocked roles",
        default: 20,
      },
      show_users_their_time_on_connected: {
        required: false,
        description:
          "Whether to show users their time when logging in to the server",
        default: true,
      },
      delay_to_show_time_on_connected: {
        required: false,
        description:
          "The delay before showing the time when logging in to the server, in seconds",
        default: 10,
      },
      delay_before_remove_player_from_squad: {
        required: false,
        description:
          "How long does it take to remove a player from the squad for a blocked role, in seconds",
        default: 10,
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
      do_update_playtime_on_mount: {
        required: false,
        description:
          "Whether to update the user`s time when running the script",
        default: true,
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.locale = y18n({
      locale: this.options.language,
      directory: "./squad-server/plugins/playtime-role-ban-locales",
    }).__;

    // {steam_id: timePlayed}
    this.playersTimes = new Map();

    this.steamUserInfoAPI = axios.create({
      baseURL: `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/`,
      params: {
        key: this.options.steam_api_key,
        include_appinfo: true,
      },
      timeout: 3000,
    });

    this.showUserPlaytime = this.showUserPlaytime.bind(this);
    this.updatePlayerPlaytime = this.updatePlayerPlaytime.bind(this);
    this.updatePlaytimeOfPlayers = this.updatePlaytimeOfPlayers.bind(this);
    this.verifyPlayerRole = this.verifyPlayerRole.bind(this);
    this.removePlayerFromSquadForRole =
      this.removePlayerFromSquadForRole.bind(this);
    this.removePlayerFromSquadForSquadLeader =
      this.removePlayerFromSquadForSquadLeader.bind(this);
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

    this.server.on("PLAYER_CONNECTED", (data) =>
      this.updatePlayerPlaytime(data.player.steamID)
    );

    if (this.options.show_users_their_time_on_connected) {
      this.server.on("PLAYER_CONNECTED", (data) => {
        setTimeout(
          () => this.showUserPlaytime(data.player.eosID),
          this.options.delay_to_show_time_on_connected * 1000
        );
      });
    }

    if (this.options.show_users_their_blocked_roles) {
      this.server.on("PLAYER_CONNECTED", (data) => {
        setTimeout(
          () => this.showUserBlockedRoles(data.player.eosID),
          this.options.delay_to_show_blocked_roles_on_connected * 1000
        );
      });
    }

    this.server.on("PLAYER_ROLE_CHANGE", (data) => {
      if (
        this.server.players.length >=
        this.options.min_number_of_players_for_work
      ) {
        this.verifyPlayerRole(data);
      }
    });

    this.server.on("PLAYER_POSSESS", (data) => {
      if (
        this.server.players.length >=
        this.options.min_number_of_players_for_work
      ) {
        this.verifyPlayerRole(data);
      }
    });

    this.server.on("PLAYER_NOW_IS_LEADER", (data) => {
      if (
        this.server.players.length >=
        this.options.min_number_of_players_for_work
      ) {
        this.verifyPlayerSquadLeader(data);
      }
    });

    if (this.options.do_update_playtime_on_mount) {
      await this.updatePlaytimeOfPlayers(this.server.players);
    }

    this.verbose(1, this.locale`Plugin has been installed`);
  }

  async verifyPlayerRole(playerRoleData) {
    const playerPlaytime = this.getPlayerPlaytime(playerRoleData.player.eosID);

    const allBlockedRoles = this.getBlockedRoles(playerPlaytime);

    if (allBlockedRoles.length === 0) {
      this.verbose(
        1,
        this
          .locale`Player ${playerRoleData.player.eosID} has more playtime than all blocked roles: ${playerPlaytime} hours, plays the allowed role ${playerRoleData.player.role}`
      );
      return;
    }

    const blockedRole = this.searchRoleInList(
      playerRoleData.player.role,
      allBlockedRoles
    );

    if (blockedRole === undefined) {
      this.verbose(
        1,
        this
          .locale`Player ${playerRoleData.player.eosID} with playtime ${playerPlaytime} plays the allowed role ${playerRoleData.player.role}`
      );
      return;
    }

    this.verbose(
      1,
      this
        .locale`Player ${playerRoleData.player.eosID} with playtime ${playerPlaytime} and role ${playerRoleData.player.role} matching the ${blockedRole.description} filter has been detected, the process of removing him from the squad has been started`
    );

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(
        playerRoleData.player.eosID,
        this
          .locale`Your playtime is unknown! Open your Steam profile so that we can allow you to play roles.`
      );
    }

    await this.server.rcon.warn(
      playerRoleData.player.eosID,
      this
        .locale`Role (${blockedRole.description}) is blocked until ${blockedRole.timePlayed} playtime, TAKE ANOTHER ONE. ${this.options.delay_before_remove_player_from_squad} seconds.`
    );
    setTimeout(
      () =>
        this.removePlayerFromSquadForRole(
          blockedRole,
          playerRoleData.player.eosID
        ),
      this.options.delay_before_remove_player_from_squad * 1000
    );
  }

  async verifyPlayerSquadLeader(playerData) {
    const playerPlaytime = this.getPlayerPlaytime(playerData.player.eosID);

    if (
      playerPlaytime < this.options.banned_squad_leader_playtime &&
      playerData.player.isLeader
    ) {
      if (playerPlaytime === TIME_IS_UNKNOWN) {
        await this.server.rcon.warn(
          playerData.player.eosID,
          this
            .locale`Your playtime is unknown! Open your Steam profile so that we can allow you to play roles.`
        );
      }

      this.verbose(
        1,
        this
          .locale`Squad leader ${playerData.player.eosID} with playtime ${playerPlaytime} hours has been detected, the process of removing him from the squad leader has been started`
      );

      await this.server.rcon.warn(
        playerData.player.eosID,
        this
          .locale`You are banned from being a squad leader until ${this.options.banned_squad_leader_playtime} playtime, DISBAND the squad or TRANSFER the role! ${this.options.delay_before_remove_player_from_squad} seconds.`
      );

      setTimeout(
        () => this.removePlayerFromSquadForSquadLeader(playerData.player.eosID),
        this.options.delay_before_remove_player_from_squad * 1000
      );
    } else {
      this.verbose(
        1,
        this
          .locale`Detected as squad leader ${playerData.player.eosID} with ${playerPlaytime} hours of playtime, squad role is allowed for him for playtime`
      );
    }
  }

  async removePlayerFromSquadForRole(blockedRole, playerEosID) {
    const player = await this.server.getPlayerByEOSID(playerEosID);

    // Вторая проверка текущей роли перед самим киком из отряда
    if (this.checkRole(player.role, blockedRole.roleRegex)) {
      await this.server.rcon.warn(
        playerEosID,
        this
          .locale`This role (${blockedRole.description}) is blocked until ${blockedRole.timePlayed} hours of playtime!`
      );
      await this.server.rcon.execute(
        `AdminRemovePlayerFromSquadById ${player.playerID}`
      );

      this.verbose(
        1,
        this
          .locale`Player ${player.eosID} was removed from the squad for the ${blockedRole.description} role`
      );
    }
  }

  async removePlayerFromSquadForSquadLeader(playerEosID) {
    const player = await this.server.getPlayerByEOSID(playerEosID);

    // Вторая проверка наличия isLeader перед киком из отряда
    if (player.isLeader) {
      await this.server.rcon.warn(
        playerEosID,
        this
          .locale`It is forbidden to be a squad leader until ${this.options.banned_squad_leader_playtime} hours of playtime!`
      );
      await this.server.rcon.execute(
        `AdminRemovePlayerFromSquadById ${player.playerID}`
      );

      this.verbose(
        1,
        this.locale`Player ${player.eosID} was removed for being a squad player`
      );
    }
  }

  async updatePlayerPlaytime(steamID) {
    let playerEosID = await this.server.getPlayerBySteamID(steamID);
    playerEosID = playerEosID.eosID;

    let response;
    try {
      response = await this.steamUserInfoAPI({
        params: {
          steamid: steamID,
        },
      });
    } catch (error) {
      this.verbose(1, this.locale`Error retrieving user's time ${error}`);
      this.verbose(
        1,
        this
          .locale`Player ${playerEosID} time was set to ${TIME_IS_UNKNOWN} because their time request returned an error`
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
        this
          .locale`Player ${playerEosID} time was set to ${TIME_IS_UNKNOWN} because their games response was empty`
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
        this
          .locale`Player ${playerEosID} time was set to ${TIME_IS_UNKNOWN} because the squad game was not found on their account`
      );
      return;
    }

    if (squadGamePlaytime === 0) {
      this.playersTimes.set(playerEosID, TIME_IS_UNKNOWN);
      this.verbose(
        1,
        this
          .locale`Player ${playerEosID} time was set to ${TIME_IS_UNKNOWN}, because their minutes in the game == 0`
      );
      return;
    }

    squadGamePlaytime = squadGamePlaytime / 60;

    this.playersTimes.set(playerEosID, squadGamePlaytime);
    this.verbose(
      1,
      this
        .locale`Player ${playerEosID}, time was set to ${squadGamePlaytime} hours`
    );
  }

  async updatePlaytimeOfPlayers(players) {
    this.verbose(
      1,
      this.locale`Updating the playtime of ${players.length} players`
    );

    for (const index in players) {
      await this.updatePlayerPlaytime(players[index].steamID);
    }

    this.verbose(1, this.locale`Updating the user list playtime has completed`);
  }

  async showUserPlaytime(eosID) {
    const playerTime = this.getPlayerPlaytime(eosID);

    if (playerTime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(
        eosID,
        this.locale`We were unable to retrieve your Squad playtime`
      );
      setTimeout(
        () =>
          this.server.rcon.warn(
            eosID,
            this
              .locale`You may have a private profile on Steam, please open it and we can allow you roles`
          ),
        3000
      );
    } else {
      await this.server.rcon.warn(
        eosID,
        this.locale`Your playtime is ${playerTime} hours`
      );
    }
  }

  async showUserBlockedRoles(eosID) {
    const playerPlaytime = this.getPlayerPlaytime(eosID);

    const blockedRoles = this.getBlockedRoles(playerPlaytime);
    if (blockedRoles.length === 0) {
      await this.server.rcon.warn(
        eosID,
        this.locale`All roles are open for you`
      );
      return;
    }

    if (playerPlaytime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(
        eosID,
        this
          .locale`We do not know your game time, please open it in your Steam privacy settings`
      );
    } else {
      await this.server.rcon.warn(
        eosID,
        this.locale`Your playtime is ${playerPlaytime} hours`
      );
    }

    for (const index in blockedRoles) {
      await this.server.rcon.warn(
        eosID,
        this
          .locale`Role blocked: ${blockedRoles[index].description} up to ${blockedRoles[index].timePlayed} hours`
      );
    }
  }

  getBlockedRoles(playtime) {
    return this.options.banned_roles.filter(
      ({ timePlayed }) => playtime < timePlayed
    );
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
      this.verbose(
        1,
        this.locale`Requested ${eosID} time which was not received earlier`
      );
    }

    return playtime || TIME_IS_UNKNOWN;
  }
}
