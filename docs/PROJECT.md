# Home Projects — Project Reference

## Background & Context

A **home improvement project manager** built around nested kanban boards. The core
problem: _"We have far more house and garden work than we can hold in our heads, and no
single place that shows what's outstanding, what's due, and what to do next."_

Trello-like boards, but with two things Trello lacks: **arbitrary nesting** (a card can
become its own board) and a **second, independent hierarchy of places** (rooms, floors,
garden areas) that projects are anchored to. **third, an overview dashboard** (what's next, quick wins, upcoming maintenance)

### Usage plan

- **Year 1**: private use by one household (2+ people).
- **Later**: possible release on Google Play and the App Store.

Consequence: build for a single household first, but do not make decisions that block
multi-tenancy, sharing, or store release.

### Key Decisions

- **Stack**: Expo + React Native + expo-router + **react-native-paper (Material 3)** +
  TypeScript + Firebase.
- **Web PWA first**, native builds later. Same codebase via React Native Web.
- **Development approach**: solo developer with heavy AI assistance.
