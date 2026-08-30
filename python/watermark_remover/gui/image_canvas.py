"""原图画布：显示缩略图，支持多形状选区、缩放与平移。"""

from __future__ import annotations

import cv2
import numpy as np
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QBrush, QColor, QImage, QPainter, QPainterPath, QPen, QPixmap, QPolygonF
from PySide6.QtWidgets import (
    QGraphicsEllipseItem,
    QGraphicsPathItem,
    QGraphicsPixmapItem,
    QGraphicsPolygonItem,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsView,
)

from image_utils import Region, RegionKind


class ImageCanvas(QGraphicsView):
    region_committed = Signal(object)

    _MIN_ZOOM = 0.1
    _MAX_ZOOM = 8.0

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setScene(QGraphicsScene(self))
        self._pixmap_item: QGraphicsPixmapItem | None = None
        self._overlay_items: list = []
        self._temp_item = None
        self._tool = RegionKind.RECT
        self._regions: list[Region] = []
        self._drag_start: QPointF | None = None
        self._pan_start: QPointF | None = None
        self._poly_points: list[QPointF] = []
        self._lasso_points: list[QPointF] = []
        self._image_size = (0, 0)
        self._zoom = 1.0
        self._auto_fit = True
        self.setDragMode(QGraphicsView.DragMode.NoDrag)
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

    def set_tool(self, tool: RegionKind) -> None:
        self.cancel_in_progress()
        self._tool = tool

    def current_tool(self) -> RegionKind:
        return self._tool

    def set_image_bgr(self, image_bgr: np.ndarray | None) -> None:
        self.scene().clear()
        self._pixmap_item = None
        self._overlay_items = []
        self._temp_item = None
        self._drag_start = None
        self._pan_start = None
        self._poly_points = []
        self._lasso_points = []
        self._zoom = 1.0
        self._auto_fit = True
        self.resetTransform()
        if image_bgr is None:
            self._image_size = (0, 0)
            self._regions = []
            return

        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        self._image_size = (w, h)
        qimage = QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888).copy()
        pixmap = QPixmap.fromImage(qimage)
        self._pixmap_item = self.scene().addPixmap(pixmap)
        self.setSceneRect(QRectF(pixmap.rect()))
        self._fit_image()
        self._redraw_regions()

    def set_regions(self, regions: list[Region]) -> None:
        self._regions = list(regions)
        self._redraw_regions()

    def _pen(self) -> QPen:
        pen = QPen(Qt.GlobalColor.red)
        pen.setWidth(2)
        return pen

    def _brush(self) -> QBrush:
        return QBrush(QColor(255, 0, 0, 50))

    def _clear_overlay(self) -> None:
        for item in self._overlay_items:
            self.scene().removeItem(item)
        self._overlay_items = []
        self._clear_temp()

    def _clear_temp(self) -> None:
        if self._temp_item is not None:
            self.scene().removeItem(self._temp_item)
            self._temp_item = None

    def _redraw_regions(self) -> None:
        if self._pixmap_item is None:
            return
        self._clear_overlay()
        for region in self._regions:
            item = self._item_for_region(region)
            if item is not None:
                self.scene().addItem(item)
                self._overlay_items.append(item)

    def _item_for_region(self, region: Region):
        if region.kind == RegionKind.RECT:
            item = QGraphicsRectItem(QRectF(region.x, region.y, region.w, region.h))
        elif region.kind == RegionKind.ELLIPSE:
            item = QGraphicsEllipseItem(QRectF(region.x, region.y, region.w, region.h))
        else:
            if len(region.points) < 2:
                return None
            poly = QPolygonF([QPointF(x, y) for x, y in region.points])
            item = QGraphicsPolygonItem(poly)
        item.setPen(self._pen())
        item.setBrush(self._brush())
        return item

    def _fit_image(self) -> None:
        if self.sceneRect().isValid():
            self.resetTransform()
            self._zoom = 1.0
            self.fitInView(self.sceneRect(), Qt.AspectRatioMode.KeepAspectRatio)
            self._auto_fit = True

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if self._auto_fit and self.sceneRect().isValid():
            self._fit_image()

    def wheelEvent(self, event) -> None:
        if event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            if self._pixmap_item is None:
                return
            angle = event.angleDelta().y()
            if angle == 0:
                return
            factor = 1.15 if angle > 0 else 1 / 1.15
            new_zoom = self._zoom * factor
            if new_zoom < self._MIN_ZOOM or new_zoom > self._MAX_ZOOM:
                return
            self._auto_fit = False
            self._zoom = new_zoom
            self.scale(factor, factor)
            event.accept()
            return
        super().wheelEvent(event)

    def _clamp_scene(self, point: QPointF) -> QPointF:
        w, h = self._image_size
        x = min(max(point.x(), 0.0), float(max(0, w - 1)))
        y = min(max(point.y(), 0.0), float(max(0, h - 1)))
        return QPointF(x, y)

    def _scene_pos(self, event) -> QPointF:
        return self._clamp_scene(self.mapToScene(event.position().toPoint()))

    def _pan_by(self, delta: QPointF) -> None:
        self._auto_fit = False
        self.horizontalScrollBar().setValue(
            int(self.horizontalScrollBar().value() - delta.x())
        )
        self.verticalScrollBar().setValue(int(self.verticalScrollBar().value() - delta.y()))

    def _rect_from_points(self, a: QPointF, b: QPointF) -> QRectF:
        w, h = self._image_size
        return QRectF(a, b).normalized().intersected(QRectF(0, 0, w, h))

    def _commit_rect_like(self, kind: RegionKind, rect: QRectF) -> None:
        if rect.width() <= 2 or rect.height() <= 2:
            return
        region = Region(
            kind=kind,
            x=int(rect.x()),
            y=int(rect.y()),
            w=int(rect.width()),
            h=int(rect.height()),
        )
        self.region_committed.emit(region)

    def _path_from_points(self, points: list[QPointF], closed: bool) -> QPainterPath:
        path = QPainterPath()
        if not points:
            return path
        path.moveTo(points[0])
        for pt in points[1:]:
            path.lineTo(pt)
        if closed and len(points) >= 2:
            path.closeSubpath()
        return path

    def _update_temp_path(self, points: list[QPointF], closed: bool) -> None:
        self._clear_temp()
        if len(points) < 1:
            return
        item = QGraphicsPathItem(self._path_from_points(points, closed))
        item.setPen(self._pen())
        item.setBrush(self._brush() if closed or len(points) >= 3 else QBrush())
        self.scene().addItem(item)
        self._temp_item = item

    def cancel_in_progress(self) -> bool:
        had = bool(self._poly_points or self._lasso_points or self._drag_start is not None)
        self._poly_points = []
        self._lasso_points = []
        self._drag_start = None
        self._clear_temp()
        return had

    def undo_in_progress(self) -> bool:
        if self._poly_points:
            self._poly_points.pop()
            if not self._poly_points:
                self._clear_temp()
            else:
                self._update_temp_path(self._poly_points, closed=False)
            return True
        if self._lasso_points:
            self.cancel_in_progress()
            return True
        return False

    def close_polygon(self) -> bool:
        if len(self._poly_points) < 3:
            return False
        pts = [(int(p.x()), int(p.y())) for p in self._poly_points]
        self._poly_points = []
        self._clear_temp()
        self.region_committed.emit(Region(kind=RegionKind.POLYGON, points=pts))
        return True

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key.Key_Escape:
            self.cancel_in_progress()
            event.accept()
            return
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            if self.close_polygon():
                event.accept()
                return
        super().keyPressEvent(event)

    def mouseDoubleClickEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton and self._tool == RegionKind.POLYGON:
            if self._poly_points:
                # 双击会先触发单击加点，去掉重复的最后一点
                if len(self._poly_points) >= 2:
                    last = self._poly_points[-1]
                    prev = self._poly_points[-2]
                    if abs(last.x() - prev.x()) < 2 and abs(last.y() - prev.y()) < 2:
                        self._poly_points.pop()
                self.close_polygon()
                event.accept()
                return
        super().mouseDoubleClickEvent(event)

    def mousePressEvent(self, event) -> None:
        if (
            event.button() in (Qt.MouseButton.MiddleButton, Qt.MouseButton.RightButton)
            and self._pixmap_item is not None
        ):
            self._pan_start = event.position()
            self.setCursor(Qt.CursorShape.ClosedHandCursor)
            event.accept()
            return

        if event.button() == Qt.MouseButton.LeftButton and self._pixmap_item is not None:
            self.setFocus()
            pos = self._scene_pos(event)
            if self._tool in (RegionKind.RECT, RegionKind.ELLIPSE):
                self._drag_start = pos
                event.accept()
                return
            if self._tool == RegionKind.POLYGON:
                self._poly_points.append(pos)
                self._update_temp_path(self._poly_points, closed=False)
                event.accept()
                return
            if self._tool == RegionKind.LASSO:
                self._lasso_points = [pos]
                event.accept()
                return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self._pan_start is not None:
            delta = event.position() - self._pan_start
            self._pan_start = event.position()
            self._pan_by(delta)
            event.accept()
            return

        if self._drag_start is not None and self._tool in (RegionKind.RECT, RegionKind.ELLIPSE):
            rect = self._rect_from_points(self._drag_start, self._scene_pos(event))
            self._clear_temp()
            if self._tool == RegionKind.RECT:
                item = QGraphicsRectItem(rect)
            else:
                item = QGraphicsEllipseItem(rect)
            item.setPen(self._pen())
            item.setBrush(self._brush())
            self.scene().addItem(item)
            self._temp_item = item
            event.accept()
            return

        if self._tool == RegionKind.POLYGON and self._poly_points:
            rubber = self._poly_points + [self._scene_pos(event)]
            self._update_temp_path(rubber, closed=False)
            event.accept()
            return

        if self._tool == RegionKind.LASSO and self._lasso_points:
            self._lasso_points.append(self._scene_pos(event))
            self._update_temp_path(self._lasso_points, closed=False)
            event.accept()
            return

        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        if event.button() in (Qt.MouseButton.MiddleButton, Qt.MouseButton.RightButton):
            self._pan_start = None
            self.setCursor(Qt.CursorShape.ArrowCursor)
            event.accept()
            return

        if event.button() == Qt.MouseButton.LeftButton:
            if self._drag_start is not None and self._tool in (RegionKind.RECT, RegionKind.ELLIPSE):
                rect = self._rect_from_points(self._drag_start, self._scene_pos(event))
                self._drag_start = None
                self._clear_temp()
                self._commit_rect_like(self._tool, rect)
                event.accept()
                return
            if self._tool == RegionKind.LASSO and self._lasso_points:
                pts = [(int(p.x()), int(p.y())) for p in self._lasso_points]
                self._lasso_points = []
                self._clear_temp()
                if len(pts) >= 3:
                    self.region_committed.emit(Region(kind=RegionKind.LASSO, points=pts))
                event.accept()
                return
        super().mouseReleaseEvent(event)
