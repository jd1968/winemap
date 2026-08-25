import React, { useEffect, useMemo, useRef, useState } from 'react';
import './MindMap.css';

function MindMap({ tree, nodesById, metadata, onRebuildFromPage, refreshing, buildProgress, isBuilding, onScrollStateChange }) {
  const [expandedNodes, setExpandedNodes] = useState(() => new Set([tree.id]));
  const [selectedNodeId, setSelectedNodeId] = useState(tree.id);
  const explorerScrollRef = useRef(null);
  const detailScrollRef = useRef(null);

  useEffect(() => {
    setExpandedNodes(new Set([tree.id]));
    setSelectedNodeId(tree.id);
  }, [tree.id]);

  useEffect(() => () => {
    onScrollStateChange(false);
  }, [onScrollStateChange]);

  const selectedNode = nodesById[selectedNodeId] || nodesById[tree.id];
  const selectedChildren = useMemo(
    () => (selectedNode?.childIds || []).map(childId => nodesById[childId]).filter(Boolean),
    [nodesById, selectedNode]
  );

  const breadcrumbs = useMemo(() => {
    const trail = [];

    const findPath = (node, targetId, path) => {
      if (!node) {
        return false;
      }

      const nextPath = [...path, node];
      if (node.id === targetId) {
        trail.push(...nextPath);
        return true;
      }

      return (node.children || []).some(child => findPath(child, targetId, nextPath));
    };

    findPath(tree, selectedNodeId, []);
    return trail;
  }, [selectedNodeId, tree]);

  const toggleNode = (nodeId) => {
    setExpandedNodes(previous => {
      const next = new Set(previous);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const selectNode = (nodeId) => {
    setSelectedNodeId(nodeId);
  };

  const updateScrollState = () => {
    const explorerTop = explorerScrollRef.current?.scrollTop || 0;
    const detailTop = detailScrollRef.current?.scrollTop || 0;
    onScrollStateChange(explorerTop > 12 || detailTop > 12);
  };

  const getNodeIcon = (type) => {
    switch (type) {
      case 'page':
      case 'child_page':
        return 'Page';
      case 'child_database':
        return 'DB';
      case 'toggle':
        return 'Tg';
      case 'column_list':
      case 'column':
        return 'Ly';
      case 'table':
      case 'table_row':
        return 'Tb';
      default:
        return 'Bl';
    }
  };

  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = node.id === selectedNodeId;
    const hasChildren = (node.children || []).length > 0;

    return (
      <div key={node.id} className="explorer-node-group">
        <div
          className={`explorer-node-row ${isSelected ? 'is-selected' : ''}`}
          style={{ paddingLeft: `${depth * 18 + 12}px` }}
        >
          <button
            type="button"
            className={`explorer-toggle ${hasChildren ? 'is-visible' : ''}`}
            onClick={() => hasChildren && toggleNode(node.id)}
            aria-label={isExpanded ? 'Collapse node' : 'Expand node'}
          >
            {hasChildren ? (isExpanded ? '−' : '+') : ''}
          </button>
          <button
            type="button"
            className="explorer-node-button"
            onClick={() => {
              selectNode(node.id);
              if (hasChildren && !expandedNodes.has(node.id)) {
                toggleNode(node.id);
              }
            }}
          >
            <span className="explorer-node-badge">{getNodeIcon(node.type)}</span>
            <span className="explorer-node-title">{node.title}</span>
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div className="explorer-node-children">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderContentBlock = (block) => {
    switch (block.type) {
      case 'heading_1':
        return <h1 className="content-heading content-heading-xl">{block.title}</h1>;
      case 'heading_2':
        return <h2 className="content-heading">{block.title}</h2>;
      case 'heading_3':
        return <h3 className="content-heading content-heading-sm">{block.title}</h3>;
      case 'divider':
        return <hr className="content-divider" />;
      case 'child_page':
      case 'page':
      case 'child_database':
        return (
          <button
            type="button"
            className="content-linked-item"
            onClick={() => selectNode(block.id)}
          >
            <span>{block.title}</span>
            <span>{getNodeIcon(block.type)}</span>
          </button>
        );
      default:
        return (
          <p className="content-text">
            {block.title || block.type.replace(/_/g, ' ')}
          </p>
        );
    }
  };

  return (
    <div className="workspace-explorer">
      <aside className="explorer-panel">
        <div className="panel-header">
          <p className="panel-label">Explorer</p>
          <h2>{metadata?.rootTitle || tree.title}</h2>
          <p className="panel-helper">
            Expand the hierarchy one level at a time. New branches appear here as the crawler discovers them and saves the snapshot locally.
          </p>
        </div>
        <div className="explorer-scroll" ref={explorerScrollRef} onScroll={updateScrollState}>
          {renderTreeNode(tree)}
        </div>
      </aside>

      <section className="detail-panel">
        <div className="detail-scroll" ref={detailScrollRef} onScroll={updateScrollState}>
          <div className="panel-header detail-header">
            <div>
              <p className="panel-label">Selected</p>
              <h2>{selectedNode?.title || 'Untitled'}</h2>
              <div className="breadcrumb-row">
                {breadcrumbs.map(crumb => (
                  <button
                    key={crumb.id}
                    type="button"
                    className={`breadcrumb-chip ${crumb.id === selectedNodeId ? 'is-active' : ''}`}
                    onClick={() => selectNode(crumb.id)}
                  >
                    {crumb.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onRebuildFromPage(selectedNodeId)}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing…' : 'Refresh this subtree'}
              </button>
            </div>
          </div>

          <div className="detail-grid">
            <div className="summary-card">
              <p className="summary-label">Children in explorer</p>
              <h3>{selectedChildren.length}</h3>
              <p className="summary-text">
                Structural descendants available from the cached hierarchy for this node.
              </p>
            </div>
            <div className="summary-card">
              <p className="summary-label">Cached on</p>
              <h3>{metadata?.builtAt ? new Date(metadata.builtAt).toLocaleString() : 'Unknown'}</h3>
              <p className="summary-text">
                Snapshot file is reused on the next launch until you rebuild.
              </p>
            </div>
            <div className="summary-card">
              <p className="summary-label">Discovery status</p>
              <h3>{isBuilding ? 'Updating live' : 'Complete'}</h3>
              <p className="summary-text">
                {buildProgress
                  ? `${buildProgress.processedNodes} processed, ${buildProgress.pendingNodes} still queued.`
                  : 'No active crawl right now.'}
              </p>
              <p className="summary-text">
                Use <strong>Full crawl from root</strong> in the top bar to rebuild the whole workspace, or <strong>Refresh this subtree</strong> here to only recrawl the selected branch.
              </p>
            </div>
          </div>

          <div className="children-section">
            <div className="section-heading">
              <h3>Explorer children</h3>
              <p>Use this list to jump through the structure without losing context.</p>
            </div>
            {selectedChildren.length > 0 ? (
              <div className="child-card-grid">
                {selectedChildren.map(child => (
                  <button
                    key={child.id}
                    type="button"
                    className="child-card"
                    onClick={() => {
                      selectNode(child.id);
                      setExpandedNodes(previous => new Set(previous).add(selectedNodeId));
                    }}
                  >
                    <span className="child-card-type">{getNodeIcon(child.type)}</span>
                    <strong>{child.title}</strong>
                    <span>{child.type.replace(/_/g, ' ')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-state">This node has no structural children in the explorer.</p>
            )}
          </div>

          <div className="content-panel">
            <div className="section-heading">
              <h3>Content snapshot</h3>
              <p>Immediate blocks cached for this page or block.</p>
            </div>
            <div className="content-panel-body">
              {selectedNode?.contentBlocks?.length > 0 ? (
                selectedNode.contentBlocks.map(block => (
                  <div key={block.id} className="content-block">
                    {renderContentBlock(block)}
                  </div>
                ))
              ) : (
                <p className="empty-state">No cached content blocks for this node yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default MindMap;
