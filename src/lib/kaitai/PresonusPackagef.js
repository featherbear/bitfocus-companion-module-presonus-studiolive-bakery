// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'kaitai-struct/KaitaiStream'], factory);
  } else if (typeof exports === 'object' && exports !== null && typeof exports.nodeType !== 'number') {
    factory(exports, require('kaitai-struct/KaitaiStream'));
  } else {
    factory(root.PresonusPackagef || (root.PresonusPackagef = {}), root.KaitaiStream);
  }
})(typeof self !== 'undefined' ? self : this, function (PresonusPackagef_, KaitaiStream) {
/**
 * Container format used by PreSonus for resource bundles.
 * 
 * Layout:
 *   - 8-byte "PACKAGEF" header
 *   - Payload: concatenated independent zlib streams (one per file)
 *   - Index: tree of Root/Folder/File entries with UTF-16LE names
 *   - 64-byte trailer pointing at the index, ending in "PACKAGEF" magic
 */

var PresonusPackagef = (function() {
  function PresonusPackagef(_io, _parent, _root) {
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;

    this._read();
  }
  PresonusPackagef.prototype._read = function() {
    this.magic = this._io.readBytes(8);
    if (!((KaitaiStream.byteArrayCompare(this.magic, new Uint8Array([80, 65, 67, 75, 65, 71, 69, 70])) == 0))) {
      throw new KaitaiStream.ValidationNotEqualError(new Uint8Array([80, 65, 67, 75, 65, 71, 69, 70]), this.magic, this._io, "/seq/0");
    }
    this.payload = this._io.readBytes(this.trailer.indexOffset - 8);
    this._raw_index = this._io.readBytes(this.trailer.indexSize);
    var _io__raw_index = new KaitaiStream(this._raw_index);
    this.index = new Index(_io__raw_index, this, this._root);
  }

  var Entry = PresonusPackagef.Entry = (function() {
    function Entry(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    Entry.prototype._read = function() {
      this.tag = KaitaiStream.bytesToStr(this._io.readBytes(4), "ASCII");
      switch (this.tag) {
      case "File":
        this.body = new FileEntry(this._io, this, this._root);
        break;
      case "Fold":
        this.body = new FolderEntry(this._io, this, this._root);
        break;
      }
    }

    return Entry;
  })();

  var FileEntry = PresonusPackagef.FileEntry = (function() {
    function FileEntry(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    FileEntry.prototype._read = function() {
      this.flags = this._io.readU4le();
      this.name = new Utf16z(this._io, this, this._root);
      this.timestamp = new Timestamp(this._io, this, this._root);
      this.reserved = this._io.readU1();
      this.offset = this._io.readU8le();
      this.compressedSize = this._io.readU8le();
      this.decompressedSize = this._io.readU8le();
    }

    /**
     * Observed 0.
     */

    /**
     * Absolute byte offset of the zlib stream in the file.
     */

    return FileEntry;
  })();

  var FolderEntry = PresonusPackagef.FolderEntry = (function() {
    function FolderEntry(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    FolderEntry.prototype._read = function() {
      this.flags = this._io.readU4le();
      this.name = new Utf16z(this._io, this, this._root);
      this.numChildren = this._io.readU4le();
      this.children = [];
      for (var i = 0; i < this.numChildren; i++) {
        this.children.push(new Entry(this._io, this, this._root));
      }
    }

    return FolderEntry;
  })();

  var Index = PresonusPackagef.Index = (function() {
    function Index(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    Index.prototype._read = function() {
      this.root = new RootEntry(this._io, this, this._root);
    }

    return Index;
  })();

  var RootEntry = PresonusPackagef.RootEntry = (function() {
    function RootEntry(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    RootEntry.prototype._read = function() {
      this.tag = this._io.readBytes(4);
      if (!((KaitaiStream.byteArrayCompare(this.tag, new Uint8Array([82, 111, 111, 116])) == 0))) {
        throw new KaitaiStream.ValidationNotEqualError(new Uint8Array([82, 111, 111, 116]), this.tag, this._io, "/types/root_entry/seq/0");
      }
      this.flags = this._io.readU4le();
      this.numChildren = this._io.readU4le();
      this.children = [];
      for (var i = 0; i < this.numChildren; i++) {
        this.children.push(new Entry(this._io, this, this._root));
      }
    }

    return RootEntry;
  })();

  var Timestamp = PresonusPackagef.Timestamp = (function() {
    function Timestamp(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    Timestamp.prototype._read = function() {
      this.year = this._io.readU2le();
      this.month = this._io.readU1();
      this.day = this._io.readU1();
      this.hour = this._io.readU1();
      this.minute = this._io.readU1();
      this.second = this._io.readU1();
      this.extra = this._io.readU1();
    }

    /**
     * Unknown. Observed 0.
     */

    return Timestamp;
  })();

  var TrailerType = PresonusPackagef.TrailerType = (function() {
    function TrailerType(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    TrailerType.prototype._read = function() {
      this.indexOffset = this._io.readU8le();
      this.indexSize = this._io.readU8le();
      this.padding = this._io.readBytes(16);
      this.misc = this._io.readBytes(16);
      this.version = this._io.readU4le();
      this.trailerSize = this._io.readU4le();
      this.trailingMagic = this._io.readBytes(8);
      if (!((KaitaiStream.byteArrayCompare(this.trailingMagic, new Uint8Array([80, 65, 67, 75, 65, 71, 69, 70])) == 0))) {
        throw new KaitaiStream.ValidationNotEqualError(new Uint8Array([80, 65, 67, 75, 65, 71, 69, 70]), this.trailingMagic, this._io, "/types/trailer_type/seq/6");
      }
    }

    /**
     * Unknown. Observed: A7 CD B0 40 95 0A 88 B1 BF FC C6 FB 00 00 00 00.
     */

    /**
     * Observed value 1.
     */

    /**
     * Observed value 0x40.
     */

    return TrailerType;
  })();

  /**
   * 2-null-byte-terminated UTF-16LE string (... 0x00 0x00).
   * The string is NOT length-prefixed, so we read bytes until we hit the terminator.
   * 
   * To obtain a decoded string in your host language, take the
   * `code_units` array minus its trailing zero and decode as UTF-16LE.
   * (Kaitai Struct has no built-in "array of u2 -> string" conversion,
   * so this step is left to the caller.)
   */

  var Utf16z = PresonusPackagef.Utf16z = (function() {
    function Utf16z(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;

      this._read();
    }
    Utf16z.prototype._read = function() {
      this.codeUnits = [];
      var i = 0;
      do {
        var _ = this._io.readU2le();
        this.codeUnits.push(_);
        i++;
      } while (!(_ == 0));
    }

    return Utf16z;
  })();

  /**
   * Parse this section first - the trailer holds the index location and is required
   * to compute the size of `payload`.
   */
  Object.defineProperty(PresonusPackagef.prototype, 'trailer', {
    get: function() {
      if (this._m_trailer !== undefined)
        return this._m_trailer;
      var _pos = this._io.pos;
      this._io.seek(this._io.size - 64);
      this._raw__m_trailer = this._io.readBytes(64);
      var _io__raw__m_trailer = new KaitaiStream(this._raw__m_trailer);
      this._m_trailer = new TrailerType(_io__raw__m_trailer, this, this._root);
      this._io.seek(_pos);
      return this._m_trailer;
    }
  });

  /**
   * Concatenated zlib streams referenced by File entries.
   */

  return PresonusPackagef;
})();
PresonusPackagef_.PresonusPackagef = PresonusPackagef;
});
