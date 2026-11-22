# Roadmap — SpinZo Ops Supervisor Improvements

| Phase | Focus | Dependencies |
|-------|-------|-------------|
| 1 | Home Dashboard filter fix + Today's Pickup tab | None |
| 2 | Ready section time slot highlighting | None |
| 3 | FloorBoard inline assign/reassign (bug fix) | Phase 1 (cleaner card context) |
| 4 | Attendance rules & fines | None |
| 5 | Operations Record Sheet | Phase 4 (reuses attendance data) |
| 6 | Rider assign/unassign from card view on Home | Phase 3 (same pattern) |
| 7 | Scheduled rider alerts (20m lead + collision/FCM fixes), break/night reminder silencing + floor fallback, and `premium_laundry` ironing pipeline (`R8`–`R10`) | None |
| 8 | Lightweight & High-Performance Overhaul: Fix rider button unresponsiveness, GPS feedback loop, flatten RiderTaskCard, restore FlatList virtualization, decouple riders from unbounded orderFeedStore, scope Firestore queries, and consolidate UI thread timers (`R11`–`R14`) | None |
| 9 | Rider Unassign Hold & Delivery Auto-Assign Status Parity (`R15`–`R16`) | None |
| 10 | Wash 36m / Dry 40m Cycle Timings, Detergent 3m / Softener 21m, & Tagging/Packaging 10m+5m Reminders (`R17`–`R18`) | None |
| 11 | Multi-Load (>8kg) Photo/Video/Bundle/Garment Aggregation & Separate Per-Load Timing Stages (`R19`) | None |
| 12 | Tagging Pre-Existing Damage Report (Camera Photo / Video + Supervisor View) (`R20`) | None |
| 13 | Floor Roster Multi-Order Modal & Dynamic Settings Helper Assignment Rules Matrix (`R21`–`R22`) | None |
