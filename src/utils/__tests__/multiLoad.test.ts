import { describe, it, expect } from 'vitest';
import { aggregateMultiLoadOrder } from '../multiLoad';

describe('aggregateMultiLoadOrder', () => {
  it('handles a single-load live order', () => {
    const order = {
      id: 'ord_100',
      serviceLabel: 'Wash & Fold',
    };
    const processes = [
      {
        id: 'ord_100',
        orderId: 'ord_100',
        loadIndex: 1,
        loadCount: 1,
        serviceLabel: 'Wash & Fold',
        garments: { count: 12 },
        stages: {
          tagging: { startedAt: 1000, completedAt: 2000 },
          packaging: {
            startedAt: 3000,
            completedAt: 4000,
            qualityProof: {
              photos: ['https://cdn/p1.jpg', 'https://cdn/p2.jpg'],
              videoUrl: 'https://cdn/v1.mp4',
              bundles: 2,
            },
          },
        },
      },
    ];

    const res = aggregateMultiLoadOrder(order, processes);
    expect(res.isMultiLoad).toBe(false);
    expect(res.loadCount).toBe(1);
    expect(res.totalGarments).toBe(12);
    expect(res.totalBundles).toBe(2);
    expect(res.photos).toEqual(['https://cdn/p1.jpg', 'https://cdn/p2.jpg']);
    expect(res.videos).toEqual([
      { url: 'https://cdn/v1.mp4', processId: 'ord_100', label: 'Wash & Fold' },
    ]);
    expect(res.loadTimings).toHaveLength(1);
    expect(res.loadTimings[0].loadIndex).toBe(1);
    expect(res.loadTimings[0].stages.tagging).toBeDefined();
  });

  it('aggregates a 2-load order across sibling processes and sorts timings by loadIndex', () => {
    const order = {
      id: 'ord_200',
      packagingPhotos: ['https://cdn/shared.jpg', 'https://cdn/p1.jpg'],
    };
    // Intentionally pass out-of-order sibling processes
    const processes = [
      {
        id: 'ord_200__2',
        orderId: 'ord_200',
        loadIndex: 2,
        loadCount: 2,
        serviceLabel: 'Wash & Iron',
        garments: { count: 8 },
        stages: {
          getting_washed: { startedAt: 2000, completedAt: 3000 },
          packaging: {
            qualityProof: {
              photos: ['https://cdn/p2.jpg'],
              videoUrl: 'https://cdn/v2.mp4',
              bundles: 1,
            },
          },
        },
      },
      {
        id: 'ord_200__1',
        orderId: 'ord_200',
        loadIndex: 1,
        loadCount: 2,
        serviceLabel: 'Wash & Fold',
        garments: { count: 14 },
        stages: {
          getting_washed: { startedAt: 1000, completedAt: 1500 },
          packaging: {
            qualityProof: {
              photos: ['https://cdn/p1.jpg'],
              videoUrl: 'https://cdn/v1.mp4',
              bundles: 2,
            },
          },
        },
      },
    ];

    const res = aggregateMultiLoadOrder(order, processes);
    expect(res.isMultiLoad).toBe(true);
    expect(res.loadCount).toBe(2);
    expect(res.totalGarments).toBe(22);
    expect(res.totalBundles).toBe(3);
    // Deduplicated photos preserving order
    expect(res.photos).toEqual(['https://cdn/p1.jpg', 'https://cdn/p2.jpg', 'https://cdn/shared.jpg']);
    expect(res.videos).toEqual([
      { url: 'https://cdn/v1.mp4', processId: 'ord_200__1', label: 'Load 1/2 · Wash & Fold' },
      { url: 'https://cdn/v2.mp4', processId: 'ord_200__2', label: 'Load 2/2 · Wash & Iron' },
    ]);
    expect(res.loadTimings).toHaveLength(2);
    expect(res.loadTimings[0].processId).toBe('ord_200__1');
    expect(res.loadTimings[0].loadIndex).toBe(1);
    expect(res.loadTimings[1].processId).toBe('ord_200__2');
    expect(res.loadTimings[1].loadIndex).toBe(2);
  });

  it('aggregates a 3-load order producing 3 separate load timing sections', () => {
    const order = { id: 'ord_300' };
    const processes = [
      {
        id: 'ord_300__3',
        orderId: 'ord_300',
        garments: { count: 5 },
        stages: {
          packaging: { qualityProof: { photos: ['https://cdn/3.jpg'], videoUrl: 'https://cdn/v3.mp4', bundles: 1 } },
        },
      },
      {
        id: 'ord_300__1',
        orderId: 'ord_300',
        garments: { count: 10 },
        stages: {
          packaging: { qualityProof: { photos: ['https://cdn/1.jpg'], videoUrl: 'https://cdn/v1.mp4', bundles: 2 } },
        },
      },
      {
        id: 'ord_300__2',
        orderId: 'ord_300',
        garments: { count: 7 },
        stages: {
          packaging: { qualityProof: { photos: ['https://cdn/2.jpg'], videoUrl: 'https://cdn/v2.mp4', bundles: 1 } },
        },
      },
    ];

    const res = aggregateMultiLoadOrder(order, processes);
    expect(res.isMultiLoad).toBe(true);
    expect(res.loadCount).toBe(3);
    expect(res.totalGarments).toBe(22);
    expect(res.totalBundles).toBe(4);
    expect(res.videos.map((v) => v.label)).toEqual(['Load 1/3', 'Load 2/3', 'Load 3/3']);
    expect(res.loadTimings).toHaveLength(3);
    expect(res.loadTimings.map((t) => t.loadIndex)).toEqual([1, 2, 3]);
  });

  it('falls back to archived order fields when orderProcesses is empty', () => {
    const archivedOrder = {
      id: 'ord_arch',
      garmentCount: 18,
      packagingPhotos: ['https://cdn/a1.jpg', 'https://cdn/a2.jpg'],
      opsDetails: {
        packagingPhotos: ['https://cdn/a2.jpg', 'https://cdn/a3.jpg'],
        packagingProof: {
          bundles: 3,
          videoUrl: 'https://cdn/fallback.mp4',
        },
        packagingVideos: [
          { url: 'https://cdn/load1.mp4', processId: 'ord_arch__1', label: 'Load 1/2' },
          { url: 'https://cdn/load2.mp4', processId: 'ord_arch__2', label: 'Load 2/2' },
        ],
        loadTimings: [
          { processId: 'ord_arch__2', label: 'Load 2/2', loadIndex: 2, loadCount: 2, stages: { tagging: { completedAt: 2 } } },
          { processId: 'ord_arch__1', label: 'Load 1/2', loadIndex: 1, loadCount: 2, stages: { tagging: { completedAt: 1 } } },
        ],
      },
    };

    const res = aggregateMultiLoadOrder(archivedOrder, []);
    expect(res.isMultiLoad).toBe(true);
    expect(res.loadCount).toBe(2);
    expect(res.totalGarments).toBe(18);
    expect(res.totalBundles).toBe(3);
    expect(res.photos).toEqual(['https://cdn/a1.jpg', 'https://cdn/a2.jpg', 'https://cdn/a3.jpg']);
    expect(res.videos).toHaveLength(3);
    expect(res.videos[0]).toEqual({ url: 'https://cdn/load1.mp4', processId: 'ord_arch__1', label: 'Load 1/2' });
    expect(res.videos[1]).toEqual({ url: 'https://cdn/load2.mp4', processId: 'ord_arch__2', label: 'Load 2/2' });
    expect(res.loadTimings).toHaveLength(2);
    expect(res.loadTimings[0].loadIndex).toBe(1);
    expect(res.loadTimings[1].loadIndex).toBe(2);
  });

  it('handles empty archived single-load order gracefully', () => {
    const res = aggregateMultiLoadOrder({ id: 'ord_empty' }, []);
    expect(res.isMultiLoad).toBe(false);
    expect(res.loadCount).toBe(1);
    expect(res.totalGarments).toBeNull();
    expect(res.totalBundles).toBeNull();
    expect(res.photos).toEqual([]);
    expect(res.videos).toEqual([]);
    expect(res.loadTimings).toEqual([]);
  });
});
