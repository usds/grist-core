var ace = require('brace');
var _ = require('underscore');
// Used to load python language settings and 'chrome' ace style
require('brace/mode/python');
require('brace/theme/chrome');
require('brace/ext/language_tools');
var {setupAceEditorCompletions} = require('./AceEditorCompletions');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var modelUtil = require('../models/modelUtil');

/**
 * A class to help set up the ace editor with standard formatting and convenience functions
 * @param {Observable} options.observable: If given, creates a 2-way binding between the observable
 *  and the value of the editor.
 * @param {Boolean} options.saveValueOnBlurEvent: Flag to indicate whether ace editor
 *  should save the value on `blur` event.
 * @param {Function} options.calcSize: Optional function used to resize the editor. It is called
 *  with (elem, desiredSize) as arguments, and should return the actual size to use for the
 *  element. Both desiredSize and the return value are objects with 'width' and 'height' members.
 */
function AceEditor(options) {
  // Observable subscription is not created until the dom is built
  this.observable = (options && options.observable) || null;
  this.saveValueOnBlurEvent = !(options && (options.saveValueOnBlurEvent === false));
  this.calcSize = (options && options.calcSize) || ((elem, size) => size);
  this.gristDoc = (options && options.gristDoc) || null;

  this.editor = null;
  this.editorDom = null;
  this.session = null;
  this._setupCallback = null;
  this._setupTimer = null;

  this.textPadding = 10; // Space after cursor when not using wrap mode
}
dispose.makeDisposable(AceEditor);

// Builds editor dom with additional setup possible in function `optSetupCallback`.
// May be called multiple times by an instance of AceEditor.
AceEditor.prototype.buildDom = function(optSetupCallback) {
  this._fullDom = dom('div.code_editor_container',
    this.editorDom = dom('div')
  );
  this._setupCallback = optSetupCallback;
  this._setupTimer = setTimeout(() => this._setup(), 0);
  return this._fullDom;
};

/**
 * You may optionally call this once the DOM returned from buildDom is attached to the document to
 * make setup and sizing more immediate.
 */
AceEditor.prototype.onAttach = function() {
  if (this._setupTimer) {
    clearTimeout(this._setupTimer);
    this._setupTimer = null;
    this._setup();
  }
};

AceEditor.prototype.writeObservable = function() {
  if (this.observable) {
    modelUtil.setSaveValue(this.observable, this.getValue());
  }
};

AceEditor.prototype.getEditor = function() {
  return this.editor;
};

AceEditor.prototype.getValue = function() {
  return this.editor && this.editor.getValue();
};

/**
 * @param {String} val: The new value to set the editor to.
 * @param {Number} optCursorPos: Position where to place the cursor: at the end if omitted.
 */
AceEditor.prototype.setValue = function(val, optCursorPos) {
  // Note that underlying setValue() has a special meaning for second parameter:
  // undefined or 0 is selectAll, -1 is at the document start, and 1 is at the end.
  this.editor.setValue(val, optCursorPos === 0 ? -1 : 1);
  if (optCursorPos > 0 && optCursorPos < val.length) {
    var pos = this.session.getDocument().indexToPosition(optCursorPos);
    this.editor.moveCursorTo(pos.row, pos.column);
  }
};

AceEditor.prototype.isBuilt = function() {
  return this.editor !== null;
};

// Enables or disables the AceEditor
AceEditor.prototype.enable = function(bool) {
  var editor = this.editor;
  editor.setReadOnly(!bool);
  editor.renderer.$cursorLayer.element.style.opacity = bool ? 100 : 0;
  editor.gotoLine(Infinity, Infinity); // Prevents text selection on disable
};

/**
 *  Commands must be added specially to the ace editor.
 *  Attaching commands to the textarea using commandGroup.attach() only
 *  works for certain keys.
 *
 *  Note: Commands to the aceEditor are always enabled.
 *  Note: Ace defers to standard behavior when false is returned.
 */
AceEditor.prototype.attachCommandGroup = function(commandGroup) {
  _.each(commandGroup.knownKeys, (command, key) => {
    this.editor.commands.addCommand({
      name: command,
      bindKey: {
        win: key,
        mac: key,
        sender: 'editor|cli'
      },
      // AceEditor wants a command to return true if it got handled, whereas our command returns
      // true to avoid stopPropagation/preventDefault, i.e. if it hasn't been handled.
      exec: () => !commandGroup.commands[command]()
    });
  });
};

/**
 *  Attaches a command to the editor which saves the current editor
 *  contents to the attached observable on 'Shift+Enter'.
 *  Throws error if there is no attached observable.
 *  TODO: Use instead of custom save command for more implementations of AceEditor
 */
AceEditor.prototype.attachSaveCommand = function() {
  if (!this.observable) {
    throw new Error("Cannot attach save command to editor with no bound observable");
  }
  var key = 'Shift+Enter';
  this.editor.commands.addCommand({
    name: 'saveFormula',
    bindKey: {
      win: key,
      mac: key,
      sender: 'editor|cli'
    },
    // AceEditor wants a command to return true if it got handled
    exec: () => {
      this.writeObservable();
      return true;
    }
  });
};

// Wraps words to the current width of the editor
AceEditor.prototype.adjustContentToWidth = function() {
  var characterWidth = this.editor.renderer.characterWidth;
  var contentWidth = this.editor.renderer.scroller.clientWidth;

  if(contentWidth > 0) {
    this.editor.getSession().setWrapLimit(parseInt(contentWidth/characterWidth, 10) - 1);
  }
};

AceEditor.prototype.setFontSize = function(pxVal) {
  this.editor.setFontSize(pxVal);
  this.resize();
};

AceEditor.prototype._setup = function() {
  // Standard editor setup
  this.editor = this.autoDisposeWith('destroy', ace.edit(this.editorDom));
  if (this.gristDoc) {
    const getSuggestions = (prefix) => {
      const tableId = this.gristDoc.viewModel.activeSection().table().tableId();
      return this.gristDoc.docComm.autocomplete(prefix, tableId);
    };
    setupAceEditorCompletions(this.editor, {getSuggestions});
  }
  this.editor.setOptions({
    enableLiveAutocompletion: true,   // use autocompletion without needing special activation.
  });
  this.session = this.editor.getSession();
  this.session.setMode('ace/mode/python');
  this.editor.setTheme('ace/theme/chrome');

  // Default line numbers to hidden
  this.editor.renderer.setShowGutter(false);
  this.session.setTabSize(2);
  this.session.setUseWrapMode(true);

  this.editor.on('change', this.resize.bind(this));
  this.editor.$blockScrolling = Infinity;
  this.editor.setFontSize(11);
  this.resize();

  // Set up the bound observable if supplied
  if (this.observable) {
    var subscription = this.observable.subscribeInit(val => {if (val !== undefined) {this.setValue(val);}});
    // Dispose with dom since subscription is created when dom is created
    dom(this.editorDom,
      dom.autoDispose(subscription)
    );

    if (this.saveValueOnBlurEvent) {
      this.editor.on('blur', () => {
        this.writeObservable();
      });
    }
  }

  if (this._setupCallback) {
    this._setupCallback.call(null, this.editor);
    this._setupCallback = null;
  }
};

AceEditor.prototype.resize = function() {
  var wrap = this.session.getUseWrapMode();
  var contentWidth = wrap ? 0 : this._getContentWidth();
  var desiredSize = {
    width: wrap ? 0 : contentWidth + this.textPadding,
    height: this._getContentHeight()
  };
  var size = this.calcSize(this._fullDom, desiredSize);
  if (size.width < contentWidth) {
    // Editor will show a horizontal scrollbar, so recalculate to make space for it.
    desiredSize.height += 20;
    size = this.calcSize(this._fullDom, desiredSize);
  }

  this.editorDom.style.width = size.width ? size.width + 'px' : 'auto';
  this.editorDom.style.height = size.height + 'px';
  this.editor.resize();
};

AceEditor.prototype._getContentWidth = function() {
  return this.session.getScreenWidth() * this.editor.renderer.characterWidth;
};

AceEditor.prototype._getContentHeight = function() {
  return Math.max(1, this.session.getScreenLength()) * this.editor.renderer.lineHeight;
};


let _RangeConstructor = null; //singleton, load it lazily
AceEditor.makeRange = function(a, b, c, d) {
  _RangeConstructor = _RangeConstructor || ace.acequire('ace/range').Range;
  return new _RangeConstructor(a, b, c, d);
};

module.exports = AceEditor;
