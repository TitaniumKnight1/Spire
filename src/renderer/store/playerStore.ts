import { create } from "zustand";

type PlayerState = {
  ready: boolean;
};

export const usePlayerStore = create<PlayerState>(() => ({
  ready: false,
}));
