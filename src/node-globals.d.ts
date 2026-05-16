declare module "fs" {
  export const existsSync: any;
  export const readFileSync: any;
  export const writeFileSync: any;
  export const mkdirSync: any;
}

declare module "node:fs" {
  export const existsSync: any;
  export const readFileSync: any;
  export const writeFileSync: any;
  export const mkdirSync: any;
}

declare module "path" {
  export const join: any;
  export const dirname: any;
  export default any;
}

declare module "node:path" {
  export const join: any;
  export const dirname: any;
  export const resolve: any;
  export default any;
}

declare module "url" {
  export const fileURLToPath: any;
}

declare module "node:sqlite" {
  export const DatabaseSync: any;
}

declare const require: any;
declare const module: any;
declare const process: any;
