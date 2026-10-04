import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryStore } from "./libraryStore";

let root: string;
let store: LibraryStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zoomcast-library-"));
  store = new LibraryStore(root);
  mkdirSync(join(root,"take"));
  writeFileSync(join(root,"take","manifest.json"), "{}");
  writeFileSync(join(root,"take","screen.mp4"), "original media");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("persistent recording organization", () => {
  it("preserves media paths and archive state across folder moves and reloads", () => {
    const folder = store.createFolder(" Tutorials ", null);
    store.archive("take",true); store.move("take",folder.id);
    expect(new LibraryStore(root).read().entries.take).toEqual({folderId:folder.id,archived:true});
    expect(readFileSync(join(root,"take","screen.mp4"),"utf8")).toBe("original media");
    store.archive("take",false); store.move("take",null);
    expect(new LibraryStore(root).read().entries.take).toEqual({folderId:null,archived:false});
    expect(store.read().folders[0]?.name).toBe("Tutorials");
  });
  it("supports nested folders and rejects duplicate sibling names without losing the index", () => {
    const parent=store.createFolder("Tutorials",null);
    const child=store.createFolder("Demos",parent.id);
    expect(child.parentId).toBe(parent.id);
    expect(() => store.createFolder(" demos ",parent.id)).toThrow("already exists");
    expect(store.createFolder("Demos",null).parentId).toBeNull();
    expect(store.read().folders).toHaveLength(3);
  });
  it("rejects path traversal and invalid destinations before changing metadata or files", () => {
    const before=store.read();
    for (const id of ["..", ".", "../take", "..\\take", "take/child", "", "missing"]) {
      expect(() => store.archive(id,true)).toThrow();
    }
    expect(() => store.move("take","missing-folder")).toThrow("no longer exists");
    expect(store.read()).toEqual(before);
    expect(existsSync(join(root,"take","screen.mp4"))).toBe(true);
  });
  it("rejects a library junction pointing at media outside the recording root", () => {
    const outside=mkdtempSync(join(tmpdir(), "zoomcast-outside-"));
    try {
      writeFileSync(join(outside,"manifest.json"), "{}");
      symlinkSync(outside,join(root,"linked"),"junction");
      expect(() => store.bundleDir("linked")).toThrow("outside the library");
      expect(existsSync(join(outside,"manifest.json"))).toBe(true);
    } finally { rmSync(join(root,"linked"),{recursive:true,force:true}); rmSync(outside,{recursive:true,force:true}); }
  });
  it("rejects bad folder names and nonexistent parents", () => {
    for (const name of ["", "  ", "foo/bar", "foo\\bar", "x".repeat(81), String.fromCharCode(1)]) expect(() => store.createFolder(name,null)).toThrow();
    expect(() => store.createFolder("Valid","missing")).toThrow();
    expect(store.read().folders).toHaveLength(0);
  });
  it("keeps damaged organization data intact rather than overwriting it with defaults", () => {
    const file=join(root,".library.json");writeFileSync(file,"{broken");
    expect(() => store.createFolder("new",null)).toThrow();
    expect(readFileSync(file,"utf8")).toBe("{broken");
  });
  it("detects circular folder hierarchies without looping", () => {
    writeFileSync(join(root,".library.json"),JSON.stringify({version:1,entries:{},folders:[{id:"a",name:"A",parentId:"b"},{id:"b",name:"B",parentId:"a"}]}));
    expect(() => store.read()).toThrow("cycle");
  });
  it("forgets only a removed recording's metadata and preserves the folders", () => {
    const folder=store.createFolder("Keep",null);store.move("take",folder.id);
    rmSync(join(root,"take"),{recursive:true});store.forget("take");
    const reloaded=new LibraryStore(root).read();
    expect(reloaded.entries.take).toBeUndefined();expect(reloaded.folders).toHaveLength(1);
  });
});
