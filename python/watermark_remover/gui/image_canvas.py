"""原图画布：显示缩略图，支持框选、缩放与平移。"""

from __future__ import annotations

import cv2
import numpy as np
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QImage, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QGraphicsPixmapItem, QGraphicsRectItem, QGraphicsScene, QGraphicsView


class ImageCanvas(QGraphicsView):
    rect_changed = Signal(tuple)

    _MIN_ZOOM = 0.1
    _MAX_ZOOM = 8.0

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setScene(QGraphicsScene(self))
        self._pixmap_item: QGraphicsPixmapItem | None = None
        self._rect_item: QGraphicsRectItem | None = None
        self._drag_start: QPointF | None = None
        self._pan_start: QPointF | None = None
        self._image_size = (0, 0)
        self._zoom = 1.0
        self._auto_fit = True
        self.setDragMode(QGraphicsView.DragMode.NoDrag)
        self.setRenderHint(QPainter.RenderHint.Antialiasing)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)

    def set_image_bgr(self, image_bgr: np.ndarray | None) -> None:
        self.scene().clear()
        self._pixmap_item = None
        self._rect_item = None
        self._drag_start = None
        self._pan_start = None
        self._zoom = 1.0
        self._auto_fit = True
        self.resetTransform()
        if image_bgr is None:
            self._image_size = (0, 0)
            return

        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        self._image_size = (w, h)
        qimage = QImage(rgb.data, w, h, ch * w, QImage.Format.Format_RGB888).copy()
        pixmap = QPixmap.fromImage(qimage)
        self._pixmap_item = self.scene().addPixmap(pixmap)
        self.setSceneRect(QRectF(pixmap.rect()))
        self._fit_image()

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

    def clear_rect(self) -> None:
        if self._rect_item is not None:
            self.scene().removeItem(self._rect_item)
            self._rect_item = None

    def set_rect(self, rect: tuple[int, int, int, int] | None) -> None:
        self.clear_rect()
        if rect is None or self._pixmap_item is None:
            return
        x, y, w, h = rect
        self._rect_item = QGraphicsRectItem(QRectF(x, y, w, h))
        pen = QPen(Qt.GlobalColor.red)
        pen.setWidth(2)
        self._rect_item.setPen(pen)
        self.scene().addItem(self._rect_item)

    def current_rect(self) -> tuple[int, int, int, int] | None:
        if self._rect_item is None:
            return None
        r = self._rect_item.rect()
        return int(r.x()), int(r.y()), int(r.width()), int(r.height())

    def _pan_by(self, delta: QPointF) -> None:
        self._auto_fit = False
        self.horizontalScrollBar().setValue(
            int(self.horizontalScrollBar().value() - delta.x())
        )
        self.verticalScrollBar().setValue(int(self.verticalScrollBar().value() - delta.y()))

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
            self._drag_start = self.mapToScene(event.position().toPoint())
            self.clear_rect()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self._pan_start is not None:
            delta = event.position() - self._pan_start
            self._pan_start = event.position()
            self._pan_by(delta)
            event.accept()
            return

        if self._drag_start is not None:
            current = self.mapToScene(event.position().toPoint())
            rect = QRectF(self._drag_start, current).normalized()
            w, h = self._image_size
            rect = rect.intersected(QRectF(0, 0, w, h))
            if self._rect_item is None:
                pen = QPen(Qt.GlobalColor.red)
                pen.setWidth(2)
                self._rect_item = QGraphicsRectItem(rect)
                self._rect_item.setPen(pen)
                self.scene().addItem(self._rect_item)
            else:
                self._rect_item.setRect(rect)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        if event.button() in (Qt.MouseButton.MiddleButton, Qt.MouseButton.RightButton):
            self._pan_start = None
            self.setCursor(Qt.CursorShape.ArrowCursor)
            event.accept()
            return

        if event.button() == Qt.MouseButton.LeftButton and self._drag_start is not None:
            rect = self.current_rect()
            self._drag_start = None
            if rect is not None and rect[2] > 2 and rect[3] > 2:
                self.rect_changed.emit(rect)
        super().mouseReleaseEvent(event)
