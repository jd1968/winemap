import React from 'react';
import './Node.css';

function Node({ node, onNodeClick, isRoot, nodes }) {
  if (!node) return null;

  const hasChildren = node.children && node.children.length > 0;
  const canExpand = node.has_children || hasChildren;

  const getNodeIcon = (type) => {
    switch (type) {
      case 'page':
      case 'child_page':
        return '📄';
      case 'child_database':
        return '🗃️';
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return '📌';
      case 'bulleted_list_item':
        return '•';
      case 'numbered_list_item':
        return '1.';
      case 'to_do':
        return '☐';
      case 'toggle':
        return '▸';
      default:
        return '◦';
    }
  };

  // Calculate radial positions for children
  const getChildrenWithPositions = () => {
    if (!hasChildren) return [];

    const childCount = node.children.length;
    const radius = 200; // Distance from parent to child

    return node.children.map((child, index) => {
      // Calculate angle for this child
      const angle = (index * 360) / childCount - 90; // Start from top
      const angleRad = (angle * Math.PI) / 180;

      // Calculate position
      const x = Math.cos(angleRad) * radius;
      const y = Math.sin(angleRad) * radius;

      return {
        child,
        x,
        y,
        angle
      };
    });
  };

  const childrenWithPositions = node.expanded ? getChildrenWithPositions() : [];

  return (
    <div className={`node-wrapper ${isRoot ? 'root-node' : ''}`}>
      <div className="node-content">
        <div
          className={`node ${isRoot ? 'node-root' : 'node-child'} ${
            node.expanded ? 'node-expanded' : ''
          } ${canExpand ? 'node-clickable' : ''}`}
          onClick={() => canExpand && onNodeClick(node.id)}
        >
          <span className="node-icon">{getNodeIcon(node.type)}</span>
          <span className="node-title">{node.title}</span>
          {canExpand && (
            <span className="node-toggle">
              {node.expanded ? '−' : '+'}
            </span>
          )}
        </div>

        {node.expanded && hasChildren && (
          <div className="node-children-radial">
            {childrenWithPositions.map(({ child, x, y }) => (
              <div
                key={child.id}
                className="child-node-radial"
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                }}
              >
                <svg className="node-connector-line" width="100%" height="100%">
                  <line
                    x1="0"
                    y1="0"
                    x2={-x}
                    y2={-y}
                    stroke="#dee2e6"
                    strokeWidth="2"
                  />
                </svg>
                <Node
                  node={nodes[child.id] || child}
                  onNodeClick={onNodeClick}
                  isRoot={false}
                  nodes={nodes}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Node;
