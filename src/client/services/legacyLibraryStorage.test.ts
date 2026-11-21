import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";

it("reopens the legacy library after a version-change closes its connection", async () => {
  const window = {} as { MetatuneStore: { database(): Promise<IDBDatabase> } };
  vm.runInNewContext(await readFile(new URL("../../../metatune/static/library-store.js", import.meta.url), "utf8"), {
    window, indexedDB: new IDBFactory()
  });
  const first = await window.MetatuneStore.database();
  first.onversionchange!.call(first, {} as IDBVersionChangeEvent);
  const reopened = await window.MetatuneStore.database();
  expect(reopened).not.toBe(first);
  reopened.close();
});
