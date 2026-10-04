import { describe, expect, it } from "vitest";
import type { RecordingSummary } from "../api";
import { folderPath, recordingLabel, visibleRecordings } from "./filter";
const recordings: RecordingSummary[] = [
  {id:"older",dir:"old",sizeBytes:30,createdAt:"2026-09-01T00:00:00Z",durationMs:5000,folderId:"folder"},
  {id:"newer",dir:"new",sizeBytes:10,createdAt:"2026-10-01T00:00:00Z",durationMs:1000,folderId:null},
  {id:"archived",dir:"archive",sizeBytes:50,createdAt:"2026-10-03T00:00:00Z",archived:true,folderId:"folder"},
];
describe("library visibility and sorting", () => {
  it("defaults to newest active recordings while keeping archive and folder scopes distinct", () => {
    expect(visibleRecordings(recordings,"all","","recent").map(r=>r.id)).toEqual(["newer","older"]);
    expect(visibleRecordings(recordings,"archive","","recent").map(r=>r.id)).toEqual(["archived"]);
    expect(visibleRecordings(recordings,{folderId:"folder"},"","recent").map(r=>r.id)).toEqual(["older"]);
    expect(visibleRecordings(recordings,"unfiled","","recent").map(r=>r.id)).toEqual(["newer"]);
  });
  it("combines trimmed case-insensitive search with sorting without mutating library data", () => {
    expect(visibleRecordings(recordings,"all"," OLDER ","recent").map(r=>r.id)).toEqual(["older"]);
    for (const sort of ["oldest","name","duration","size"] as const) {
      const expected=sort==="name"?["newer","older"]:["older","newer"];
      expect(visibleRecordings(recordings,"all","",sort).map(r=>r.id)).toEqual(expected);
    }
    expect(visibleRecordings(recordings,"all",recordingLabel(recordings[0] as RecordingSummary),"recent").map(r=>r.id)).toEqual(["older"]);
    expect(recordings.map(r=>r.id)).toEqual(["older","newer","archived"]);
  });
  it("builds folder breadcrumbs and terminates safely with malformed ancestry", () => {
    const folders=[{id:"parent",name:"Tutorials",parentId:null},{id:"child",name:"Demos",parentId:"parent"}];
    expect(folderPath(folders,"child").map(f=>f.name)).toEqual(["Tutorials","Demos"]);
    expect(folderPath([{id:"cycle",name:"Cycle",parentId:"cycle"}],"cycle")).toHaveLength(1);
    expect(folderPath(folders,"missing")).toEqual([]);
  });
});
