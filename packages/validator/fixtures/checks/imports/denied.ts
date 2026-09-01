import "blocked-package";
export { localValue } from "./target";

declare const moduleName: string;
void import(moduleName);
