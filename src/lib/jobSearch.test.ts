import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLabel, searchJobs } from "./jobSearch";

const jobs = [
  { id: "a", name: "Test Street Strip-out", jobNo: "26_101", client: "Example Builders", address: "1 Test St, Sometown" },
  { id: "b", name: "Sample School Demolition", jobNo: "26_102", client: "Sample Constructions", address: "9 Other Rd, Elsewhere" },
  { id: "c", name: "Harbour Fitout", jobNo: null, client: null, address: null, status: "COMPLETE" },
];
const ids = (q: string) => searchJobs(jobs, q).map((j) => j.id);

test("matches name, job number, client and address, any case", () => {
  assert.deepEqual(ids("strip"), ["a"]);
  assert.deepEqual(ids("26_102"), ["b"]);
  assert.deepEqual(ids("EXAMPLE builders"), ["a"]);
  assert.deepEqual(ids("other rd"), ["b"]);
});

test("every word must match, in any order", () => {
  assert.deepEqual(ids("demolition sample"), ["b"]);
  assert.deepEqual(ids("school sometown"), []);
});

test("an empty search lists the jobs; an exact job number comes first", () => {
  assert.deepEqual(ids("  "), ["a", "b", "c"]);
  assert.deepEqual(ids("26_10"), ["a", "b"]);
  assert.deepEqual(searchJobs(jobs, "", 2).length, 2);
});

test("labels show the number and a non-active status", () => {
  assert.equal(jobLabel(jobs[0]), "26_101 · Test Street Strip-out");
  assert.equal(jobLabel(jobs[2]), "Harbour Fitout (complete)");
});
