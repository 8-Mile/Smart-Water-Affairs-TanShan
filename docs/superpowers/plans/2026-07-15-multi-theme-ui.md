# Multi-Theme UI Implementation Plan

> **For agentic workers:** Implement task-by-task from the design spec.

**Goal:** Four deliverable UI shells (harbor/slate/orchid/ember) with build-time lock and DEV-only switcher.

**Architecture:** Theme registry maps id → layout + login + CSS tokens; ThemeShell/ThemeLoginHost pick components; production uses `VITE_UI_THEME` only.

**Tech Stack:** Vue 3, Element Plus, Vite env vars, CSS variables.

**Spec:** `docs/superpowers/specs/2026-07-15-multi-theme-ui-design.md`
