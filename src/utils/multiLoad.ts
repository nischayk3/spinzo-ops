export interface LoadVideoItem {
  url: string;
  processId: string;
  label: string;
}

export interface LoadTimingSection {
  processId: string;
  label: string;
  loadIndex: number;
  loadCount: number;
  stages: Record<string, any>;
}

export interface AggregatedMultiLoadData {
  isMultiLoad: boolean;
  loadCount: number;
  totalGarments: number | null;
  totalBundles: number | null;
  photos: string[];
  videos: LoadVideoItem[];
  loadTimings: LoadTimingSection[];
}

function inferLoadIndex(proc: any, fallbackIndex: number): number {
  if (typeof proc?.loadIndex === 'number' && Number.isFinite(proc.loadIndex) && proc.loadIndex > 0) {
    return Math.floor(proc.loadIndex);
  }
  const id = typeof proc?.id === 'string' ? proc.id : '';
  const match = id.match(/__(?:load_)?(\d+)$/i);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallbackIndex;
}

function buildLoadLabel(loadIndex: number, loadCount: number, serviceLabel?: string): string {
  const cleanService = typeof serviceLabel === 'string' ? serviceLabel.trim() : '';
  if (loadCount > 1) {
    return cleanService ? `Load ${loadIndex}/${loadCount} · ${cleanService}` : `Load ${loadIndex}/${loadCount}`;
  }
  return cleanService || 'Load 1/1';
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return null;
}

function addUniquePhotos(target: string[], seen: Set<string>, source: unknown): void {
  if (!Array.isArray(source)) return;
  for (const item of source) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    target.push(trimmed);
  }
}

function addUniqueVideo(
  target: LoadVideoItem[],
  seen: Set<string>,
  url: unknown,
  processId: string,
  label: string
): void {
  if (typeof url !== 'string') return;
  const trimmed = url.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  target.push({ url: trimmed, processId, label });
}

function collectOrderVideos(
  target: LoadVideoItem[],
  seen: Set<string>,
  source: unknown,
  defaultProcessId: string,
  defaultLabel: string
): void {
  if (!Array.isArray(source)) return;
  source.forEach((entry, idx) => {
    if (typeof entry === 'string') {
      const label = source.length > 1 ? `Load ${idx + 1}/${source.length}` : defaultLabel;
      addUniqueVideo(target, seen, entry, `${defaultProcessId}__${idx + 1}`, label);
    } else if (entry && typeof entry === 'object') {
      const obj = entry as Record<string, any>;
      const label =
        typeof obj.label === 'string' && obj.label.trim()
          ? obj.label.trim()
          : source.length > 1
          ? `Load ${idx + 1}/${source.length}`
          : defaultLabel;
      const processId =
        typeof obj.processId === 'string' && obj.processId.trim()
          ? obj.processId.trim()
          : `${defaultProcessId}__${idx + 1}`;
      addUniqueVideo(target, seen, obj.url ?? obj.videoUrl, processId, label);
    }
  });
}

export function aggregateMultiLoadOrder(order: any, orderProcesses: any[] = []): AggregatedMultiLoadData {
  const safeOrder = order && typeof order === 'object' ? order : {};
  const opsDetails = safeOrder.opsDetails && typeof safeOrder.opsDetails === 'object' ? safeOrder.opsDetails : {};
  const validProcesses = Array.isArray(orderProcesses) ? orderProcesses.filter(Boolean) : [];
  const defaultOrderId = String(safeOrder.id || safeOrder.orderId || 'order');

  const photos: string[] = [];
  const seenPhotos = new Set<string>();
  const videos: LoadVideoItem[] = [];
  const seenVideos = new Set<string>();

  if (validProcesses.length > 0) {
    const indexed = validProcesses.map((proc, idx) => ({
      proc,
      loadIndex: inferLoadIndex(proc, idx + 1),
      originalIdx: idx,
    }));
    indexed.sort((a, b) => a.loadIndex - b.loadIndex || a.originalIdx - b.originalIdx);

    const declaredMaxCount = indexed.reduce((max, item) => {
      const lc = toFiniteNumber(item.proc?.loadCount) ?? toFiniteNumber(item.proc?.siblingCount) ?? 0;
      return Math.max(max, lc);
    }, 0);
    const loadCount = Math.max(indexed.length, declaredMaxCount, 1);

    let garmentSum = 0;
    let hasGarmentCount = false;
    let bundleSum = 0;
    let hasBundleCount = false;

    const loadTimings: LoadTimingSection[] = indexed.map(({ proc, loadIndex }) => {
      const processId = String(proc.id || `${defaultOrderId}__${loadIndex}`);
      const label = buildLoadLabel(loadIndex, loadCount, proc.serviceLabel);

      const gCount =
        toFiniteNumber(proc?.garments?.count) ??
        toFiniteNumber(proc?.garmentCount);
      if (gCount !== null) {
        garmentSum += gCount;
        hasGarmentCount = true;
      }

      const qp = proc?.stages?.packaging?.qualityProof ?? proc?.qualityProof ?? proc?.packagingProof;
      const bCount =
        toFiniteNumber(qp?.bundles) ??
        toFiniteNumber(proc?.bundleCount);
      if (bCount !== null) {
        bundleSum += bCount;
        hasBundleCount = true;
      }

      addUniquePhotos(photos, seenPhotos, qp?.photos);
      addUniquePhotos(photos, seenPhotos, proc?.packagingPhotos);

      addUniqueVideo(videos, seenVideos, qp?.videoUrl, processId, label);
      if (Array.isArray(qp?.videos)) {
        for (const v of qp.videos) {
          addUniqueVideo(videos, seenVideos, typeof v === 'string' ? v : v?.url, processId, label);
        }
      }

      return {
        processId,
        label,
        loadIndex,
        loadCount,
        stages: proc.stages && typeof proc.stages === 'object' ? proc.stages : {},
      };
    });

    // Also merge any order-level photos & videos without duplicating
    addUniquePhotos(photos, seenPhotos, safeOrder.packagingPhotos);
    addUniquePhotos(photos, seenPhotos, safeOrder.packagingProof?.photos);
    addUniquePhotos(photos, seenPhotos, opsDetails.packagingPhotos);
    addUniquePhotos(photos, seenPhotos, opsDetails.packagingProof?.photos);

    const fallbackVideoLabel = safeOrder.serviceLabel || (loadCount > 1 ? `Load 1/${loadCount}` : 'Load 1/1');
    collectOrderVideos(videos, seenVideos, safeOrder.packagingVideos, defaultOrderId, fallbackVideoLabel);
    collectOrderVideos(videos, seenVideos, opsDetails.packagingVideos, defaultOrderId, fallbackVideoLabel);
    addUniqueVideo(videos, seenVideos, safeOrder.packagingProof?.videoUrl, defaultOrderId, fallbackVideoLabel);
    addUniqueVideo(videos, seenVideos, opsDetails.packagingProof?.videoUrl, defaultOrderId, fallbackVideoLabel);

    const orderGarmentFallback =
      toFiniteNumber(safeOrder.garmentCount) ??
      toFiniteNumber(opsDetails.garmentCount) ??
      toFiniteNumber(opsDetails.garments?.count);
    const totalGarments = hasGarmentCount
      ? (garmentSum > 0 ? garmentSum : (orderGarmentFallback ?? garmentSum))
      : orderGarmentFallback;

    const orderBundleFallback =
      toFiniteNumber(safeOrder.packagingProof?.bundles) ??
      toFiniteNumber(opsDetails.packagingProof?.bundles) ??
      toFiniteNumber(safeOrder.bundleCount) ??
      toFiniteNumber(opsDetails.bundleCount);
    const totalBundles = hasBundleCount ? bundleSum : orderBundleFallback;

    return {
      isMultiLoad: loadCount > 1 || loadTimings.length > 1,
      loadCount,
      totalGarments,
      totalBundles,
      photos,
      videos,
      loadTimings,
    };
  }

  // Archived / completed order fallback (no live ops_process documents)
  const rawArchivedTimings = Array.isArray(safeOrder.loadTimings)
    ? safeOrder.loadTimings
    : Array.isArray(opsDetails.loadTimings)
    ? opsDetails.loadTimings
    : [];

  let loadTimings: LoadTimingSection[] = [];
  if (rawArchivedTimings.length > 0) {
    const normalized = rawArchivedTimings.map((sec: any, idx: number) => {
      const loadIndex =
        typeof sec?.loadIndex === 'number' && Number.isFinite(sec.loadIndex) && sec.loadIndex > 0
          ? Math.floor(sec.loadIndex)
          : idx + 1;
      return { sec, loadIndex, originalIdx: idx };
    });
    normalized.sort((a: any, b: any) => a.loadIndex - b.loadIndex || a.originalIdx - b.originalIdx);

    const inferredCount = Math.max(
      normalized.length,
      ...normalized.map((n: any) => toFiniteNumber(n.sec?.loadCount) ?? 0),
      1
    );

    loadTimings = normalized.map(({ sec, loadIndex }: any) => {
      const processId = String(sec?.processId || `${defaultOrderId}__${loadIndex}`);
      const label =
        typeof sec?.label === 'string' && sec.label.trim()
          ? sec.label.trim()
          : buildLoadLabel(loadIndex, inferredCount, sec?.serviceLabel);
      return {
        processId,
        label,
        loadIndex,
        loadCount: inferredCount,
        stages: sec?.stages && typeof sec.stages === 'object' ? sec.stages : {},
      };
    });
  } else {
    const singleStages = opsDetails.stages ?? safeOrder.stages;
    if (singleStages && typeof singleStages === 'object' && Object.keys(singleStages).length > 0) {
      loadTimings = [
        {
          processId: defaultOrderId,
          label: buildLoadLabel(1, 1, safeOrder.serviceLabel || opsDetails.serviceLabel),
          loadIndex: 1,
          loadCount: 1,
          stages: singleStages,
        },
      ];
    }
  }

  addUniquePhotos(photos, seenPhotos, safeOrder.packagingPhotos);
  addUniquePhotos(photos, seenPhotos, safeOrder.packagingProof?.photos);
  addUniquePhotos(photos, seenPhotos, opsDetails.packagingPhotos);
  addUniquePhotos(photos, seenPhotos, opsDetails.packagingProof?.photos);

  const archivedVideoListCount = Math.max(
    Array.isArray(safeOrder.packagingVideos) ? safeOrder.packagingVideos.length : 0,
    Array.isArray(opsDetails.packagingVideos) ? opsDetails.packagingVideos.length : 0
  );

  const loadCount = Math.max(
    loadTimings.length,
    toFiniteNumber(safeOrder.loadCount) ?? 0,
    toFiniteNumber(opsDetails.loadCount) ?? 0,
    archivedVideoListCount,
    1
  );

  const defaultLabel = buildLoadLabel(1, loadCount, safeOrder.serviceLabel || opsDetails.serviceLabel);
  collectOrderVideos(videos, seenVideos, safeOrder.packagingVideos, defaultOrderId, defaultLabel);
  collectOrderVideos(videos, seenVideos, opsDetails.packagingVideos, defaultOrderId, defaultLabel);
  addUniqueVideo(videos, seenVideos, safeOrder.packagingProof?.videoUrl, defaultOrderId, defaultLabel);
  addUniqueVideo(videos, seenVideos, opsDetails.packagingProof?.videoUrl, defaultOrderId, defaultLabel);

  const totalGarments =
    toFiniteNumber(safeOrder.garmentCount) ??
    toFiniteNumber(opsDetails.garmentCount) ??
    toFiniteNumber(opsDetails.garments?.count);

  const totalBundles =
    toFiniteNumber(safeOrder.packagingProof?.bundles) ??
    toFiniteNumber(opsDetails.packagingProof?.bundles) ??
    toFiniteNumber(safeOrder.bundleCount) ??
    toFiniteNumber(opsDetails.bundleCount);

  return {
    isMultiLoad: loadCount > 1 || loadTimings.length > 1,
    loadCount,
    totalGarments,
    totalBundles,
    photos,
    videos,
    loadTimings,
  };
}
