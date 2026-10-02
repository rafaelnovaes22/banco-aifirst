// PORQUÊ: @receptron/laya é opcional e não instalado por default.
// A declaração ambiente libera o import dinâmico em laya-loader.ts;
// o contrato real é validado em runtime pelos guards do provider.
declare module "@receptron/laya" {
  import type { LayaLoadOptions, LayaRunner } from "../domain/laya-provider.js";

  export const Laya: {
    load(options: LayaLoadOptions): Promise<LayaRunner>;
  };
}
