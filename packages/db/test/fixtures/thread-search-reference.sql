
    WITH token_matches AS (

      SELECT
        s.thread_id AS threadId,
        ? AS tokenIndex,
        MIN(thread_search_segments_fts.rank) AS tokenRank
      FROM thread_search_segments_fts
      JOIN thread_search_segments AS s ON s.rowid = thread_search_segments_fts.rowid
      WHERE thread_search_segments_fts MATCH ?
      GROUP BY s.thread_id
     UNION ALL
      SELECT
        s.thread_id AS threadId,
        ? AS tokenIndex,
        MIN(thread_search_segments_fts.rank) AS tokenRank
      FROM thread_search_segments_fts
      JOIN thread_search_segments AS s ON s.rowid = thread_search_segments_fts.rowid
      WHERE thread_search_segments_fts MATCH ?
      GROUP BY s.thread_id
     UNION ALL
      SELECT
        s.thread_id AS threadId,
        ? AS tokenIndex,
        MIN(thread_search_segments_fts.rank) AS tokenRank
      FROM thread_search_segments_fts
      JOIN thread_search_segments AS s ON s.rowid = thread_search_segments_fts.rowid
      WHERE thread_search_segments_fts MATCH ?
      GROUP BY s.thread_id

    ),
    ranked_threads AS (
      SELECT
        token_matches.threadId AS threadId,
        MIN(token_matches.tokenRank) AS bestRank,
        MAX(t.updated_at) AS threadUpdatedAt,
        MAX(t.archived_at IS NOT NULL) AS archived
      FROM token_matches
      JOIN threads AS t ON t.id = token_matches.threadId
      WHERE t.deleted_at IS NULL
        AND t.visibility = 'visible'
      GROUP BY threadId
      HAVING COUNT(DISTINCT token_matches.tokenIndex) = ?
    ),
    ordered_threads AS (
      SELECT
        threadId,
        archived,
        ROW_NUMBER() OVER (
          PARTITION BY archived
          ORDER BY bestRank ASC, threadUpdatedAt DESC, threadId DESC
        ) AS threadOrder,
        COUNT(*) OVER (PARTITION BY archived) AS total
      FROM ranked_threads
    ),
    limited_threads AS (
      SELECT threadId, archived, threadOrder, total
      FROM ordered_threads
      WHERE threadOrder <= ?
    ),
    ranked_segments AS (
      SELECT
        limited_threads.archived AS archived,
        limited_threads.threadOrder AS threadOrder,
        limited_threads.total AS total,
        ROW_NUMBER() OVER (
          PARTITION BY thread_search_segments.thread_id, thread_search_segments.source_kind IN ('title', 'title_fallback')
          ORDER BY
            thread_search_segments_fts.rank ASC,
            COALESCE(thread_search_segments.source_seq, -1) ASC,
            thread_search_segments.id ASC
        ) AS segmentOrder,
        thread_search_segments.source_kind IN ('title', 'title_fallback') AS isTitle,
        thread_search_segments.source_kind AS sourceKind,
        thread_search_segments.source_seq AS sourceSeq,
        thread_search_segments.text AS text,
        thread_search_segments.thread_id AS threadId
      FROM thread_search_segments_fts
      JOIN thread_search_segments
        ON thread_search_segments.rowid = thread_search_segments_fts.rowid
      JOIN limited_threads
        ON limited_threads.threadId = thread_search_segments.thread_id
      WHERE thread_search_segments_fts MATCH ?
    )
    SELECT
      archived,
      threadOrder,
      total,
      segmentOrder,
      sourceKind,
      sourceSeq,
      text,
      threadId
    FROM ranked_segments
    WHERE isTitle = 1
      OR segmentOrder <= ?
    ORDER BY archived ASC, threadOrder ASC, isTitle DESC, segmentOrder ASC
