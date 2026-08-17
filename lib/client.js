window.__ModuleLoader__.load({ id: '@better-webui/better-webui', factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  var React = require('react');
  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  var STORAGE_KEY = 'better-webui.trash';

  function readTrash() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (_) {
      return new Set();
    }
  }

  function writeTrash(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (_) { /* storage unavailable */ }
  }

  function textOf(content) {
    return (content || [])
      .filter(function (block) { return block && block.type === 'text' && typeof block.text === 'string'; })
      .map(function (block) { return block.text; })
      .join('\n');
  }

  function truncateHeadTail(text, headLines, tailLines) {
    headLines = headLines || 50;
    tailLines = tailLines || 50;
    var lines = String(text).split('\n');
    if (lines.length <= headLines + tailLines) {
      return { head: text, omitted: 0, tail: '' };
    }
    return {
      head: lines.slice(0, headLines).join('\n'),
      omitted: lines.length - headLines - tailLines,
      tail: lines.slice(lines.length - tailLines).join('\n'),
    };
  }

  function ToolOutput(props) {
    var text = props.text || '';
    var label = props.label || 'Output';
    var headLines = props.headLines || 50;
    var tailLines = props.tailLines || 50;
    var tr = useMemo(function () { return truncateHeadTail(text, headLines, tailLines); }, [text, headLines, tailLines]);
    return h('details', { className: 'better-webui-tool-output' },
      h('summary', null, label + (tr.omitted > 0 ? ' (full: ' + text.length.toLocaleString() + ' chars, first ' + headLines + ' / last ' + tailLines + ' lines)' : '')),
      h('div', { className: 'better-tool-output-body' },
        tr.omitted > 0 ? h('div', { className: 'better-tool-output-omitted' }, '… ' + tr.omitted + ' line' + (tr.omitted === 1 ? '' : 's') + ' omitted …') : null,
        h('pre', null, text),
        h('div', { className: 'better-tool-output-actions' },
          h('button', { type: 'button', onClick: function () { navigator.clipboard && navigator.clipboard.writeText(text).catch(function () {}); } }, 'Copy full output'),
          h('button', { type: 'button', onClick: function () {
            var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            window.open(url, '_blank', 'noopener');
          } }, 'Open full output')
        )
      )
    );
  }

  function resultText(block) {
    if (!block || block.kind !== 'tool-result') return '';
    return textOf(block.content);
  }

  function BashBetterRow(props) {
    var output = resultText(props.block);
    return h('div', { className: 'better-webui-bash-row' },
      h('div', { className: 'better-webui-bash-head' }, props.toolName || 'bash'),
      output ? ToolOutput({ text: output, label: 'Output' }) : h('div', { className: 'better-webui-bash-empty' }, 'No output')
    );
  }

  function sortSessions(sessions, trashed) {
    var active = [];
    var removed = [];
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      (trashed.has(s.sessionId) ? removed : active).push(s);
    }
    return active.concat(removed);
  }

  function buildNodes(sessions) {
    var byId = new Map();
    var nodes = new Map();
    sessions.forEach(function (s) {
      byId.set(s.sessionId, s);
      nodes.set(s.sessionId, { entry: s, children: [] });
    });
    var roots = [];
    sessions.forEach(function (s) {
      var node = nodes.get(s.sessionId);
      if (!node) return;
      var parent = s.parentSessionId;
      var parentNode = parent ? nodes.get(parent) : undefined;
      if (parentNode) parentNode.children.push(node);
      else roots.push(node);
    });
    return roots;
  }

  function BetterSidebar(props) {
    var useSessions = props.useSessions;
    var list = useSessions(function (state) { return state.items; });
    var trashState = useState(function () { return readTrash(); });
    var trashed = trashState[0];
    var setTrashed = trashState[1];
    var expandedState = useState(new Set());
    var expanded = expandedState[0];
    var setExpanded = expandedState[1];

    var sessions = useMemo(function () { return sortSessions(list, trashed); }, [list, trashed]);
    var roots = useMemo(function () { return buildNodes(sessions); }, [sessions]);

    function toggle(id) {
      setExpanded(function (prev) {
        var next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    function trash(id) {
      var next = new Set(trashed);
      next.add(id);
      setTrashed(next);
      writeTrash(next);
    }
    function restore(id) {
      var next = new Set(trashed);
      next.delete(id);
      setTrashed(next);
      writeTrash(next);
    }
    function destroy(id) {
      var next = new Set(trashed);
      next.delete(id);
      setTrashed(next);
      writeTrash(next);
    }

    function renderNode(node) {
      var session = node.entry;
      var isTrashed = trashed.has(session.sessionId);
      var canExpand = node.children.length > 0;
      var isExpanded = expanded.has(session.sessionId);
      var row = h('div', {
        key: session.sessionId,
        role: 'treeitem',
        'aria-selected': false,
        'aria-expanded': canExpand ? isExpanded : undefined,
        'data-trashed': isTrashed || undefined,
        className: 'better-webui-row',
        style: { paddingLeft: (8 + (session.depth || 0) * 16) + 'px', opacity: isTrashed ? 0.55 : undefined }
      },
        canExpand
          ? h('button', { type: 'button', onClick: function () { toggle(session.sessionId); } }, isExpanded ? '▾' : '▸')
          : h('span', { className: 'better-webui-row-spacer' }),
        h('button', {
          type: 'button',
          className: 'better-webui-title',
          title: isTrashed ? 'Session is in trash; content is hidden.' : session.title,
          onClick: function () { if (props.onOpen) props.onOpen(session.sessionId); }
        }, session.blank ? 'New chat' : (session.title || 'Untitled')),
        isTrashed
          ? h('span', { className: 'better-webui-actions' },
              h('button', { type: 'button', onClick: function () { restore(session.sessionId); } }, 'Restore'),
              h('button', { type: 'button', onClick: function () {
                if (window.confirm('Permanently delete this session? This cannot be undone.')) destroy(session.sessionId);
              } }, 'Delete forever')
            )
          : h('button', { type: 'button', onClick: function () {
              if (window.confirm('Move this session to trash? It will stay visible, greyed out.')) trash(session.sessionId);
            } }, 'Delete')
      );
      var children = (canExpand && isExpanded)
        ? h('div', { className: 'better-webui-children' }, node.children.map(renderNode))
        : null;
      return h('div', { key: session.sessionId }, row, children);
    }

    return h('div', { className: 'better-webui-sidebar' },
      h('div', { className: 'better-webui-header' },
        h('button', { type: 'button', onClick: props.onNewSession }, 'New session')
      ),
      h('div', { className: 'better-webui-tree', role: 'tree' }, roots.map(renderNode))
    );
  }

  function UserBranchNodeView(props) {
    var text = textOf(props.node.data.content);
    return h('div', { className: 'better-webui-user-message' },
      h('div', { className: 'better-webui-user-text' }, text),
      h('button', { type: 'button', className: 'better-webui-branch', onClick: function () {
        if (props.forkAt) props.forkAt(props.node.data.seq);
      } }, 'Branch from here')
    );
  }

  exports.apply = function apply(ctx) {
    // Sidebar override: trashed sessions grey/last, branch tree collapsible.
    ctx.slots.inject('sidebar.workspaces', function () {
      return ctx.slots.register({
        name: 'sidebar.workspaces',
        priority: -1,
        inject: function () {
          return {
            onOpen: function (sessionId) { ctx.sessions.open(sessionId); },
            onNewSession: function () { ctx.workspaces.startSession(); }
          };
        }
      }, BetterSidebar);
    });

    // Tool output: bash output in a default-collapsed <details>.
    ctx.slots.inject('tool.call.toolview', function () {
      return ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'bash',
        priority: -1
      }, BashBetterRow);
    });

    // Branch from a user message.
    ctx.slots.inject('conversation.chat.node', function () {
      return ctx.slots.register({
        name: 'conversation.chat.node',
        key: 'user',
        priority: -1
      }, UserBranchNodeView);
    });
    ctx.slots.inject('conversation.chat.node', function () {
      return ctx.slots.register({
        name: 'conversation.chat.node',
        key: 'steering',
        priority: -1
      }, UserBranchNodeView);
    });
  };

  return module.exports;
} });
