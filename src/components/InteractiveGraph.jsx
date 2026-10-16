import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  Network, 
  RefreshCw, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw
} from 'lucide-react';
import { db, syncSemanticLinks, subscribeNlpStatus } from '../db';

// Fixed similarity threshold as requested
const FIXED_THRESHOLD = 0.40;

/**
 * Interactive D3 Force-Directed Semantic Knowledge Graph
 * - Fixed boundary-constrained viewport so nodes never exit visible space
 * - Fixed similarity threshold at 0.40
 * - Clean solid node styling without dotted glow halos
 * - Interactive hover inspection tooltip
 */
export default function InteractiveGraph({
  activeNoteId,
  onSelectNote
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  const [isSyncingNLP, setIsSyncingNLP] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Persistent references to preserve simulation and node positions across note updates
  const simulationRef = useRef(null);
  const zoomBehaviorRef = useRef(null);
  const nodePositionsRef = useRef(new Map());

  // Listen for background NLP sync updates
  useEffect(() => {
    const unsubscribe = subscribeNlpStatus((status) => {
      setIsSyncingNLP(status.state === 'computing' || status.state === 'loading');
    });
    return unsubscribe;
  }, []);

  // Fetch all notes in real time from Dexie
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);

  // Fetch all pairwise semantic links computed by NLP
  const rawSemanticLinks = useLiveQuery(() => db.semanticLinks.toArray(), [], []);

  // Filter semantic links with fixed threshold (>= 0.40) and valid notes
  const { filteredLinks, validNotes } = useMemo(() => {
    if (!notes || notes.length === 0) {
      return { filteredLinks: [], validNotes: [] };
    }

    const noteIdSet = new Set(notes.map((n) => n.id));
    const valid = notes.filter((n) => noteIdSet.has(n.id));

    if (!rawSemanticLinks || rawSemanticLinks.length === 0) {
      return { filteredLinks: [], validNotes: valid };
    }

    const passing = rawSemanticLinks.filter((link) => {
      return (
        link.score >= FIXED_THRESHOLD &&
        noteIdSet.has(link.sourceNoteId) &&
        noteIdSet.has(link.targetNoteId) &&
        link.sourceNoteId !== link.targetNoteId
      );
    });

    return { filteredLinks: passing, validNotes: valid };
  }, [notes, rawSemanticLinks]);

  // Compute node connection degrees
  const nodeDegrees = useMemo(() => {
    const map = new Map();
    validNotes.forEach((n) => map.set(n.id, 0));
    filteredLinks.forEach((l) => {
      map.set(l.sourceNoteId, (map.get(l.sourceNoteId) || 0) + 1);
      map.set(l.targetNoteId, (map.get(l.targetNoteId) || 0) + 1);
    });
    return map;
  }, [validNotes, filteredLinks]);

  // Manual trigger to re-run semantic NLP analysis
  const handleTriggerNlp = async () => {
    try {
      setIsSyncingNLP(true);
      await syncSemanticLinks(FIXED_THRESHOLD);
    } catch (err) {
      console.error('NLP sync error:', err);
    } finally {
      setIsSyncingNLP(false);
    }
  };

  // Zoom controls
  const handleZoomIn = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(250)
        .call(zoomBehaviorRef.current.scaleBy, 1.25);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(250)
        .call(zoomBehaviorRef.current.scaleBy, 0.8);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomBehaviorRef.current) {
      d3.select(svgRef.current)
        .transition()
        .duration(350)
        .call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
    }
  };

  // ------------------- D3 FORCE SIMULATION (STABLE & BOUNDED) -------------------
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || validNotes.length === 0) return;

    const width = containerRef.current.clientWidth || 340;
    const height = containerRef.current.clientHeight || 450;
    const padding = 32; // boundary padding ensuring nodes never exit visible space

    const svg = d3.select(svgRef.current);
    svg.attr('width', width).attr('height', height);

    let g = svg.select('g.graph-container');
    if (g.empty()) {
      g = svg.append('g').attr('class', 'graph-container');
      g.append('g').attr('class', 'links-layer');
      g.append('g').attr('class', 'nodes-layer');
    }

    // Set up D3 Zoom
    const zoom = d3
      .zoom()
      .scaleExtent([0.3, 3.0])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    zoomBehaviorRef.current = zoom;
    svg.call(zoom);

    // Reuse persistent positions so existing nodes stay completely stable when new notes are added
    const graphNodes = validNotes.map((n) => {
      let storedPos = nodePositionsRef.current.get(n.id);
      if (!storedPos) {
        // New note: place near center with gentle offset
        storedPos = {
          x: width / 2 + (Math.random() - 0.5) * 40,
          y: height / 2 + (Math.random() - 0.5) * 40,
          vx: 0,
          vy: 0
        };
        nodePositionsRef.current.set(n.id, storedPos);
      }

      return {
        id: n.id,
        title: n.title || 'Untitled Note',
        content: n.content || '',
        degree: nodeDegrees.get(n.id) || 0,
        x: storedPos.x,
        y: storedPos.y,
        vx: storedPos.vx || 0,
        vy: storedPos.vy || 0
      };
    });

    // Clean up removed notes from position map
    const activeIds = new Set(validNotes.map((n) => n.id));
    for (const key of nodePositionsRef.current.keys()) {
      if (!activeIds.has(key)) {
        nodePositionsRef.current.delete(key);
      }
    }

    const graphLinks = filteredLinks.map((l) => ({
      id: `${l.sourceNoteId}-${l.targetNoteId}`,
      source: l.sourceNoteId,
      target: l.targetNoteId,
      score: l.score
    }));

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    // Gentle force simulation configured for stability and strict boundary constraints
    const simulation = d3
      .forceSimulation(graphNodes)
      .force(
        'link',
        d3
          .forceLink(graphLinks)
          .id((d) => d.id)
          .distance((d) => Math.max(55, 130 - d.score * 70))
          .strength((d) => Math.max(0.12, d.score * 0.5))
      )
      .force('charge', d3.forceManyBody().strength(-120))
      // Inward centering forces without abrupt centroid translation
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04))
      .force('collision', d3.forceCollide().radius((d) => 24 + (d.degree || 0) * 1.5))
      .velocityDecay(0.4) // higher damping prevents oscillating or sliding
      .alphaDecay(0.04)
      .alpha(0.2); // start with gentle warm energy instead of violent explosion

    simulationRef.current = simulation;

    // ------------------- RENDER LINKS -------------------
    const linksLayer = g.select('g.links-layer');
    const linkSelection = linksLayer
      .selectAll('line.link-line')
      .data(graphLinks, (d) => `${d.source.id || d.source}-${d.target.id || d.target}`);

    linkSelection.exit().remove();

    const linkEnter = linkSelection
      .enter()
      .append('line')
      .attr('class', 'link-line')
      .attr('stroke-linecap', 'round')
      .style('cursor', 'pointer');

    const allLinks = linkEnter.merge(linkSelection);

    allLinks
      .attr('stroke', (d) => {
        if (d.score >= 0.7) return '#38bdf8';
        if (d.score >= 0.5) return '#818cf8';
        return '#64748b';
      })
      .attr('stroke-width', (d) => Math.max(1.2, 1 + d.score * 3))
      .attr('stroke-opacity', (d) => Math.min(0.8, 0.25 + d.score * 0.5))
      .on('mouseenter', (event, d) => {
        d3.select(event.currentTarget)
          .attr('stroke', '#a5b4fc')
          .attr('stroke-width', (d.score * 4) + 2)
          .attr('stroke-opacity', 1);

        const sourceTitle =
          typeof d.source === 'object' ? d.source.title : validNotes.find((n) => n.id === d.source)?.title || 'Note';
        const targetTitle =
          typeof d.target === 'object' ? d.target.title : validNotes.find((n) => n.id === d.target)?.title || 'Note';

        setHoveredLink({
          sourceTitle,
          targetTitle,
          score: d.score
        });

        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setTooltipPos({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          });
        }
      })
      .on('mouseleave', (event, d) => {
        d3.select(event.currentTarget)
          .attr('stroke', (d) => {
            if (d.score >= 0.7) return '#38bdf8';
            if (d.score >= 0.5) return '#818cf8';
            return '#64748b';
          })
          .attr('stroke-width', Math.max(1.2, 1 + d.score * 3))
          .attr('stroke-opacity', Math.min(0.8, 0.25 + d.score * 0.5));
        setHoveredLink(null);
      });

    // ------------------- RENDER NODES -------------------
    const nodesLayer = g.select('g.nodes-layer');
    const nodeSelection = nodesLayer.selectAll('g.node-group').data(graphNodes, (d) => d.id);

    nodeSelection.exit().remove();

    const nodeEnter = nodeSelection
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .style('cursor', 'pointer');

    // Main solid node circle (NO dotted halo)
    nodeEnter
      .append('circle')
      .attr('class', 'node-circle')
      .attr('r', 11)
      .attr('stroke-width', 2);

    // Inner center dot
    nodeEnter
      .append('circle')
      .attr('class', 'node-center-dot')
      .attr('r', 3)
      .attr('fill', '#ffffff')
      .attr('opacity', 0.85);

    // Text label background pill for readability
    nodeEnter
      .append('rect')
      .attr('class', 'label-bg')
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', '#090d16')
      .attr('fill-opacity', 0.88)
      .attr('stroke', '#1e293b')
      .attr('stroke-width', 0.5);

    // Text label
    nodeEnter
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('fill', '#cbd5e1')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none');

    const allNodes = nodeEnter.merge(nodeSelection);

    // Apply clean solid node visual styling
    allNodes.each(function (d) {
      const group = d3.select(this);
      const isActive = d.id === activeNoteId;
      const radius = 10 + Math.min(5, (d.degree || 0) * 1.2);

      group
        .select('circle.node-circle')
        .attr('r', radius)
        .attr('fill', isActive ? '#4f46e5' : '#1e293b')
        .attr('stroke', isActive ? '#38bdf8' : d.degree > 0 ? '#6366f1' : '#475569')
        .attr('stroke-width', isActive ? 2.5 : 1.8);

      const shortTitle = d.title.length > 15 ? d.title.slice(0, 14) + '…' : d.title;
      const label = group
        .select('text.node-label')
        .text(shortTitle)
        .attr('dy', radius + 13)
        .attr('fill', isActive ? '#ffffff' : '#cbd5e1')
        .attr('font-weight', isActive ? '600' : '400');

      const bbox = label.node() ? label.node().getBBox() : { width: 36, height: 12 };
      group
        .select('rect.label-bg')
        .attr('x', -bbox.width / 2 - 3)
        .attr('y', radius + 3)
        .attr('width', bbox.width + 6)
        .attr('height', bbox.height + 2);
    });

    // Drag behavior with boundary clamping
    const drag = d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.15).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = Math.max(padding, Math.min(width - padding, event.x));
        d.fy = Math.max(padding, Math.min(height - padding, event.y));
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    allNodes.call(drag);

    // Node click & hover interactions (showing informative tooltip on hover)
    allNodes
      .on('click', (event, d) => {
        event.stopPropagation();
        if (onSelectNote) {
          onSelectNote(d.id);
        }
      })
      .on('mouseenter', (event, d) => {
        const connectedNodeIds = new Set();
        connectedNodeIds.add(d.id);

        allLinks.each(function (l) {
          const sId = l.source.id || l.source;
          const tId = l.target.id || l.target;
          const isConnected = sId === d.id || tId === d.id;

          if (isConnected) {
            connectedNodeIds.add(sId);
            connectedNodeIds.add(tId);
            d3.select(this)
              .attr('stroke', '#38bdf8')
              .attr('stroke-width', (l.score * 4) + 2)
              .attr('stroke-opacity', 1);
          } else {
            d3.select(this).attr('stroke-opacity', 0.08);
          }
        });

        // Dim unconnected nodes slightly
        allNodes.each(function (n) {
          const isConn = connectedNodeIds.has(n.id);
          d3.select(this).attr('opacity', isConn ? 1 : 0.25);
        });

        // Hover tooltip data
        const related = filteredLinks
          .filter((l) => l.sourceNoteId === d.id || l.targetNoteId === d.id)
          .map((l) => {
            const isSource = l.sourceNoteId === d.id;
            return {
              otherTitle: isSource ? l.targetTitle : l.sourceTitle,
              score: l.score
            };
          })
          .sort((a, b) => b.score - a.score);

        setHoveredNode({
          id: d.id,
          title: d.title,
          content: d.content,
          connections: related
        });

        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setTooltipPos({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          });
        }
      })
      .on('mouseleave', () => {
        allLinks
          .attr('stroke', (d) => {
            if (d.score >= 0.7) return '#38bdf8';
            if (d.score >= 0.5) return '#818cf8';
            return '#64748b';
          })
          .attr('stroke-width', (d) => Math.max(1.2, 1 + d.score * 3))
          .attr('stroke-opacity', (d) => Math.min(0.8, 0.25 + d.score * 0.5));

        allNodes.attr('opacity', 1);
        setHoveredNode(null);
      });

    // ------------------- SIMULATION TICK (STRICT BOUNDARY CONSTRAINTS) -------------------
    simulation.on('tick', () => {
      // Clamp node coordinates strictly within visible container boundaries
      allNodes.each((d) => {
        d.x = Math.max(padding, Math.min(width - padding, d.x));
        d.y = Math.max(padding, Math.min(height - padding, d.y));
        nodePositionsRef.current.set(d.id, { x: d.x, y: d.y, vx: d.vx, vy: d.vy });
      });

      allLinks
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      allNodes.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [validNotes, filteredLinks, nodeDegrees, onSelectNote]);

  // Dedicated effect for active note selection without restarting physics simulation
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('g.node-group').each(function (d) {
      const group = d3.select(this);
      const isActive = d.id === activeNoteId;
      const radius = 10 + Math.min(5, (d.degree || 0) * 1.2);

      group
        .select('circle.node-circle')
        .attr('fill', isActive ? '#4f46e5' : '#1e293b')
        .attr('stroke', isActive ? '#38bdf8' : d.degree > 0 ? '#6366f1' : '#475569')
        .attr('stroke-width', isActive ? 2.5 : 1.8);

      group
        .select('text.node-label')
        .attr('fill', isActive ? '#ffffff' : '#cbd5e1')
        .attr('font-weight', isActive ? '600' : '400');
    });
  }, [activeNoteId]);

  // Handle window resizing
  useEffect(() => {
    if (!containerRef.current || !svgRef.current) return;
    const observer = new ResizeObserver(() => {
      if (containerRef.current && svgRef.current) {
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        d3.select(svgRef.current).attr('width', width).attr('height', height);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900/30 overflow-hidden select-none relative">
      {/* ------------------- HEADER ------------------- */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Interactive Graph
          </span>
        </div>
      </div>

      {/* ------------------- BOUNDED GRAPH CANVAS ------------------- */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-slate-950">
        <svg
          ref={svgRef}
          className="w-full h-full block cursor-grab active:cursor-grabbing"
        />

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-slate-900/90 border border-slate-800/80 rounded-lg p-1 backdrop-blur-md shadow-lg z-20">
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleResetZoom}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition cursor-pointer"
            title="Reset Zoom / Center Graph"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Empty state when there are 0 or 1 note */}
        {validNotes.length <= 1 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-500 pointer-events-none">
            <Network className="w-10 h-10 text-indigo-400/30 mb-2" />
            <p className="text-xs font-medium text-slate-300">Semantic Graph</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-[200px]">
              Add 2 or more notes to discover and map semantic connections.
            </p>
          </div>
        )}

        {/* ------------------- HOVER INFO TOOLTIP (ONLY NAME & LINK COUNT) ------------------- */}
        {hoveredNode && (
          <div
            className="absolute z-30 pointer-events-none px-3 py-1.5 rounded-lg bg-slate-900/95 border border-indigo-500/40 text-slate-100 text-xs shadow-xl backdrop-blur-md transition-opacity duration-150 flex items-center gap-2"
            style={{
              left: Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth || 300) - 180),
              top: Math.max(10, tooltipPos.y - 10)
            }}
          >
            <span className="font-semibold text-indigo-300 truncate max-w-[140px]">
              {hoveredNode.title}
            </span>
            <span className="text-[11px] font-mono text-slate-400 shrink-0">
              {hoveredNode.connections.length} {hoveredNode.connections.length === 1 ? 'link' : 'links'}
            </span>
          </div>
        )}

        {/* Hovered link tooltip */}
        {hoveredLink && !hoveredNode && (
          <div
            className="absolute z-30 pointer-events-none p-2 rounded-lg bg-slate-900/95 border border-cyan-500/40 text-slate-100 text-xs shadow-2xl backdrop-blur-md transition-opacity duration-150"
            style={{
              left: Math.min(tooltipPos.x + 10, (containerRef.current?.clientWidth || 300) - 200),
              top: Math.max(10, tooltipPos.y - 10)
            }}
          >
            <div className="text-[10px] text-slate-400 font-mono">Semantic Similarity</div>
            <div className="text-xs font-medium text-cyan-300 truncate max-w-[180px]">
              {hoveredLink.sourceTitle} ↔ {hoveredLink.targetTitle}
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Score:</span>
              <span className="font-mono font-bold text-emerald-400 text-xs">
                {hoveredLink.score.toFixed(2)} ({(hoveredLink.score * 100).toFixed(0)}% match)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
