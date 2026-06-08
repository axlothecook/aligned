// @aligned/core — shared code imported by both apps/web and apps/api.
//
// What lives here over time:
//   - domain types (User, Calendar, Event, ...) shared across the stack
//   - the API client (typed fetch wrappers the web + mobile call)
//   - pure logic with no UI/DB deps — notably the free-slot MERGE algorithm
//     (interval/sweep-line; see docs/DESIGN.md decision #7)
//
// Keep this package framework-agnostic: no React, no DOM, no DB client imports.

export const CORE_VERSION = '0.0.0';

export * from './freeslots';
