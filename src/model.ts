import { MutableDataModel, DataModel } from '@lumino/datagrid';
import { DSVModel } from 'tde-csvviewer';
import { Signal } from '@lumino/signaling';
import { numberToCharacter } from './_helper';

export default class EditableDSVModel extends MutableDataModel {
  constructor(options: DSVModel.IOptions, headerLength: number) {
    super();
    this._dsvModel = new DSVModel(options);
    this._colHeaderLength = headerLength;
  }

  get dsvModel(): DSVModel {
    return this._dsvModel;
  }

  get onChangedSignal(): Signal<this, string> {
    return this._onChangeSignal;
  }

  get colHeaderLength(): number {
    return this._colHeaderLength;
  }

  set colHeaderLength(length: number) {
    this._colHeaderLength = length;
  }

  rowCount(region: DataModel.RowRegion): number {
    return this._dsvModel.rowCount(region);
  }

  columnCount(region: DataModel.ColumnRegion): number {
    return this._dsvModel.columnCount(region);
  }

  metadata(
    region: DataModel.CellRegion,
    row: number,
    column: number
  ): DataModel.Metadata {
    return { type: 'string' };
  }

  data(region: DataModel.CellRegion, row: number, column: number): any {
    return this._dsvModel.data(region, row, column);
  }
  // TODO: Do we need to handle cases for column-headers/row-headers?
  // Could we make some assumptions that would lead to a faster update?
  // Ex. We know that a row-header is close to row 0.
  // calling setData with value = null performs an inversion if the last operation was a setData operation.

  setData(
    region: DataModel.CellRegion,
    row: number,
    column: number,
    value: any
  ): boolean {
    const model = this.dsvModel;
    this.sliceOut(model, { row: row + 1, column: column + 1 }, true);
    this.insertAt(value, model, { row: row + 1, column: column + 1 });
    model.parseAsync();
    const change: DataModel.ChangedArgs = {
      type: 'cells-changed',
      region: 'body',
      row: row,
      column: column,
      rowSpan: 1,
      columnSpan: 1
    };
    this.emitChanged(change);
    this._onChangeSignal.emit(
      this._dsvModel.rawData.slice(this.colHeaderLength)
    );
    return true;
  }

  addRow(row: number): void {
    const model = this.dsvModel;
    const newRow = this.blankRow(model, row);
    this.insertAt(newRow, model, { row: row + 1, column: 0 });
    const change: DataModel.ChangedArgs = {
      type: 'rows-inserted',
      region: 'body',
      index: row,
      span: 1
    };
    model.parseAsync();
    this.emitChanged(change);
    this._onChangeSignal.emit(
      this._dsvModel.rawData.slice(this.colHeaderLength)
    );
  }

  addColumn(column: number): void {
    const model = this.dsvModel;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let row: number;
    for (row = model.rowCount('body'); row > 0; row--) {
      this.insertAt(model.delimiter, model, { row: row, column: column + 1 });
    }
    const prevNumCol = this.columnCount('body');
    const nextLetter = numberToCharacter(alphabet, prevNumCol + 1);
    model.rawData =
      model.rawData.slice(0, this._colHeaderLength - 1) +
      model.delimiter +
      nextLetter +
      model.rawData.slice(this._colHeaderLength - 1);

    this.colHeaderLength += model.delimiter.length + nextLetter.length;
    // need to push the letter to the header here so that it updates
    model.header.push(nextLetter);

    const change: DataModel.ChangedArgs = {
      type: 'columns-inserted',
      region: 'body',
      index: column,
      span: 1
    };
    model.parseAsync();
    this.emitChanged(change);
    this._onChangeSignal.emit(
      this._dsvModel.rawData.slice(this._colHeaderLength)
    );
  }

  removeRow(row: number): void {
    const model = this.dsvModel;
    this.sliceOut(model, { row: row + 1, column: 0 });

    const change: DataModel.ChangedArgs = {
      type: 'rows-removed',
      region: 'body',
      index: row,
      span: 1
    };
    model.parseAsync();
    this.emitChanged(change);
    this._onChangeSignal.emit(
      this._dsvModel.rawData.slice(this.colHeaderLength)
    );
  }

  removeColumn(column: number): void {
    const model = this.dsvModel;
    let row: number;
    for (row = model.rowCount('body'); row > 0; row--) {
      this.sliceOut(model, { row: row, column: column + 1 });
    }
    // update rawData and header (header handles immediate update, rawData handles parseAsync)
    // slice out the last letter in the column header
    const headerIndex = model.rawData.lastIndexOf(
      model.delimiter,
      this._colHeaderLength
    );
    const slicedHeader = model.rawData.slice(
      headerIndex,
      this._colHeaderLength
    );
    model.rawData =
      model.rawData.slice(0, headerIndex) +
      model.rowDelimiter +
      model.rawData.slice(this._colHeaderLength);
    // the -1 is to account for the row delimeter
    this.colHeaderLength -= slicedHeader.length - 1;
    // need to remove the last letter from the header
    const change: DataModel.ChangedArgs = {
      type: 'columns-removed',
      region: 'body',
      index: column,
      span: 1
    };
    model.parseAsync();
    this.emitChanged(change);
    this._onChangeSignal.emit(
      this._dsvModel.rawData.slice(this._colHeaderLength)
    );
  }

  sliceOut(
    model: DSVModel,
    cellLoc: ICoordinates,
    keepingCell = false
  ): string {
    let sliceStart: number;
    let sliceEnd: number;
    if (keepingCell) {
      sliceStart = this.firstIndex(cellLoc);
      sliceEnd = this.lastIndex(cellLoc);
      // check whether we are removing last row (or column)
    } else if (this.isTrimOperation(cellLoc)) {
      const prevCell = this.getPreviousCell(cellLoc);
      sliceStart = this.lastIndex(prevCell);
      sliceEnd = this.lastIndex(cellLoc);
    } else {
      sliceStart = this.firstIndex(cellLoc);
      sliceEnd = this.firstIndex(this.getNextCell(cellLoc));
    }
    const value = model.rawData.slice(sliceStart, sliceEnd);
    model.rawData =
      model.rawData.slice(0, sliceStart) + model.rawData.slice(sliceEnd);
    return value;
  }

  insertAt(value: any, model: DSVModel, cellLoc: ICoordinates): void {
    let insertionIndex: number;
    //check if we are appending an additional row (or column)
    if (this.isExtensionOperation(cellLoc)) {
      const prevCell = this.getPreviousCell(cellLoc);
      insertionIndex = this.lastIndex(prevCell);
    } else {
      insertionIndex = this.firstIndex(cellLoc);
    }
    model.rawData =
      model.rawData.slice(0, insertionIndex) +
      value +
      model.rawData.slice(insertionIndex);
  }
  blankRow(model: DSVModel, row: number): string {
    const rows = model.rowCount('body');
    if (row > rows) {
      return (
        model.rowDelimiter +
        model.delimiter.repeat(model.columnCount('body') - 1)
      );
    }
    return (
      model.delimiter.repeat(model.columnCount('body') - 1) + model.rowDelimiter
    );
  }

  /**
   *
   * @param coords: the coordinates of the cell.
   */
  firstIndex(coords: ICoordinates): number {
    const { row, column } = coords;
    return this.dsvModel.getOffsetIndex(row, Math.max(0, column - 1));
  }

  lastIndex(coords: ICoordinates): number {
    const { row, column } = coords;
    const columns = this.dsvModel.columnCount('body');
    const delim = this.dsvModel.delimiter.length;
    if (0 < column && column < columns) {
      return this.dsvModel.getOffsetIndex(row, column) - delim;
    }
    return this.rowEnd(row);
  }

  rowEnd(row: number): number {
    const rows = this.dsvModel.rowCount('body');
    const rowDelim = this.dsvModel.rowDelimiter.length;
    if (row < rows) {
      return this.dsvModel.getOffsetIndex(row + 1, 0) - rowDelim;
    }
    return this.dsvModel.rawData.length;
  }
  // checks whether we are removing data cells on the last row or the last column.
  isTrimOperation(coords: ICoordinates): boolean {
    const { row, column } = coords;
    const rows = this.dsvModel.rowCount('body');
    const columns = this.dsvModel.columnCount('body');
    return column === columns || (row === rows && column === 0);
  }
  // checks whether we are appending a column to the end or appending a row to the end.
  // This would mainly come up if we were undoing a trim operation.
  isExtensionOperation(coords: ICoordinates): boolean {
    const { row, column } = coords;
    const rows = this.dsvModel.rowCount('body');
    const columns = this.dsvModel.columnCount('body');
    return column > columns || row > rows;
  }

  getPreviousCell(coords: ICoordinates): ICoordinates {
    const { row, column } = coords;
    const columns = this.dsvModel.columnCount('body');
    switch (column) {
      case 0: {
        return { row: Math.max(row - 1, 0), column: 0 };
      }
      case 1: {
        return { row: Math.max(row - 1, 0), column: columns };
      }
      default: {
        return { row: row, column: column - 1 };
      }
    }
  }

  getNextCell(coords: ICoordinates): ICoordinates {
    const { row, column } = coords;
    const columns = this.dsvModel.columnCount('body');
    const rows = this.dsvModel.rowCount('body');
    switch (column) {
      case 0: {
        return { row: Math.min(row + 1, rows), column: 0 };
      }
      case columns: {
        return { row: Math.min(row + 1, rows), column: 1 };
      }
      default: {
        return { row: row, column: column + 1 };
      }
    }
  }

  private _dsvModel: DSVModel;
  private _onChangeSignal: Signal<this, string> = new Signal<this, string>(
    this
  );

  private _colHeaderLength: number;
}

interface ICoordinates {
  row: number;
  column: number;
}
