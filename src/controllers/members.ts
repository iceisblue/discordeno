import { eventHandlers } from "../module/client.ts";
import { structures } from "../structures/mod.ts";
import { DiscordPayload } from "../types/discord.ts";
import {
  GuildBanPayload,
  GuildMemberAddPayload,
  GuildMemberChunkPayload,
  GuildMemberUpdatePayload,
} from "../types/guild.ts";
import { cache } from "../utils/cache.ts";
import { cacheHandlers } from "./cache.ts";

export async function handleInternalGuildMemberAdd(data: DiscordPayload) {
  if (data.t !== "GUILD_MEMBER_ADD") return;

  const payload = data.d as GuildMemberAddPayload;
  const guild = await cacheHandlers.get("guilds", payload.guild_id);
  if (!guild) return;

  guild.memberCount++;
  const member = await structures.createMember(
    payload,
    guild.id,
  );

  eventHandlers.guildMemberAdd?.(guild, member);
}

export async function handleInternalGuildMemberRemove(data: DiscordPayload) {
  if (data.t !== "GUILD_MEMBER_REMOVE") return;

  const payload = data.d as GuildBanPayload;
  const guild = await cacheHandlers.get("guilds", payload.guild_id);
  if (!guild) return;

  guild.memberCount--;
  const member = await cacheHandlers.get("members", payload.user.id);
  eventHandlers.guildMemberRemove?.(
    guild,
    member || payload.user,
  );

  member?.guilds.delete(guild.id);
  if (member && !member.guilds.size) cacheHandlers.delete("members", member.id);
}

export async function handleInternalGuildMemberUpdate(data: DiscordPayload) {
  if (data.t !== "GUILD_MEMBER_UPDATE") return;

  const payload = data.d as GuildMemberUpdatePayload;
  const guild = await cacheHandlers.get("guilds", payload.guild_id);
  if (!guild) return;

  const cachedMember = await cacheHandlers.get("members", payload.user.id);

  const newMemberData = {
    ...payload,
    premium_since: payload.premium_since || undefined,
    joined_at: new Date(cachedMember?.joinedAt || Date.now())
      .toISOString(),
    deaf: cachedMember?.deaf || false,
    mute: cachedMember?.mute || false,
    roles: payload.roles,
  };
  const member = await structures.createMember(
    newMemberData,
    guild.id,
  );

  if (cachedMember?.nick !== payload.nick) {
    eventHandlers.nicknameUpdate?.(
      guild,
      member,
      payload.nick,
      cachedMember?.nick,
    );
  }
  const roleIDs = cachedMember?.roles || [];

  roleIDs.forEach((id) => {
    if (!payload.roles.includes(id)) {
      eventHandlers.roleLost?.(guild, member, id);
    }
  });

  payload.roles.forEach((id) => {
    if (!roleIDs.includes(id)) {
      eventHandlers.roleGained?.(guild, member, id);
    }
  });

  eventHandlers.guildMemberUpdate?.(guild, member, cachedMember);
}

export async function handleInternalGuildMembersChunk(data: DiscordPayload) {
  if (data.t !== "GUILD_MEMBERS_CHUNK") return;

  const payload = data.d as GuildMemberChunkPayload;
  const guild = await cacheHandlers.get("guilds", payload.guild_id);
  if (!guild) return;

  await Promise.all(
    payload.members.map((member) => structures.createMember(member, guild.id)),
  );

  // Check if its necessary to resolve the fetchmembers promise for this chunk or if more chunks will be coming
  if (
    payload.nonce
  ) {
    const resolve = cache.fetchAllMembersProcessingRequests.get(payload.nonce);
    if (!resolve) return;

    if (payload.chunk_index + 1 === payload.chunk_count) {
      cache.fetchAllMembersProcessingRequests.delete(payload.nonce);
      resolve(
        await cacheHandlers.filter("members", (m) => m.guilds.has(guild.id)),
      );
    }
  }
}
