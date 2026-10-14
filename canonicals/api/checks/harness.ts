// Shared check setup. Reserved path.
import { fromArenaState, type ArenaState, type ObsEvent } from "../src/events";
import fixture from "./fixture-state.json";

export const NOW = new Date("2026-10-07T07:00:00.000Z");
export const EVENTS: readonly ObsEvent[] = fromArenaState(fixture as unknown as ArenaState);
