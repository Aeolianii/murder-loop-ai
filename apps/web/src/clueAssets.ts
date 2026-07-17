export interface ClueAsset {
  imageUrl: string;
}

export const CLUE_ASSETS: Record<string, ClueAsset> = {
  c1: {
    imageUrl: new URL('../../../image/模糊的包裹.png', import.meta.url).href,
  },
  wrong_package: {
    imageUrl: new URL('../../../image/模糊的包裹.png', import.meta.url).href,
  },
  package_photo: {
    imageUrl: new URL('../../../image/给包裹拍照.png', import.meta.url).href,
  },
  linyue_has_photo: {
    imageUrl: new URL('../../../image/林越收到包裹.png', import.meta.url).href,
  },
  door_scratch: {
    imageUrl: new URL('../../../image/锁芯划痕.png', import.meta.url).href,
  },
  recording_pressure: {
    imageUrl: new URL('../../../image/录音停顿.png', import.meta.url).href,
  },
  police_verified: {
    imageUrl: new URL('../../../image/校验警方.png', import.meta.url).href,
  },
  unknown_number_probe: {
    imageUrl: new URL('../../../image/陌生号码试探包裹.png', import.meta.url).href,
  },
};

export function getClueAsset(clueId: string) {
  return CLUE_ASSETS[clueId] ?? null;
}
