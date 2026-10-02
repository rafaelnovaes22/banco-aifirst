// PORQUÊ: @receptron/laya é dependência opcional e pesada (ONNX + 1,7 GB
// de pesos no primeiro uso). O import dinâmico mantém install, CI e Docker
// leves; sem o pacote instalado, o shadow local fica indisponível em
// silêncio e o legado assume. Ativação: npm i @receptron/laya + LAYA_ENABLED.

import type { LayaLoader } from "./laya-provider.js";

export function lazyLayaLoader(): LayaLoader {
  return {
    load: async (options) => {
      let mod: typeof import("@receptron/laya");
      try {
        mod = await import("@receptron/laya");
      } catch {
        throw new Error(
          "@receptron/laya ausente: instale o pacote para ativar o shadow local",
        );
      }
      return mod.Laya.load({
        revision: options.revision,
        cacheDir: options.cacheDir,
        modelDir: options.modelDir,
      });
    },
  };
}
