package __BASE_PACKAGE__.domain.entity;

import com.baomidou.mybatisplus.annotation.FieldFill;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import java.time.LocalDateTime;

/** 审计字段与主键。业务实体继承本类。 */
public abstract class BaseEntity {

  @TableId(value = "c_id", type = IdType.ASSIGN_UUID)
  private String id;

  @TableField(value = "c_created_user", fill = FieldFill.INSERT)
  private String createdUser;

  @TableField(value = "dt_created_at", fill = FieldFill.INSERT)
  private LocalDateTime createdAt;

  @TableField(value = "dt_updated_at", fill = FieldFill.INSERT_UPDATE)
  private LocalDateTime updatedAt;

  @TableField(value = "c_updated_user", fill = FieldFill.INSERT_UPDATE)
  private String updatedUser;

  public String getId() {
    return id;
  }

  public void setId(String id) {
    this.id = id;
  }

  public String getCreatedUser() {
    return createdUser;
  }

  public void setCreatedUser(String createdUser) {
    this.createdUser = createdUser;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }

  public LocalDateTime getUpdatedAt() {
    return updatedAt;
  }

  public void setUpdatedAt(LocalDateTime updatedAt) {
    this.updatedAt = updatedAt;
  }

  public String getUpdatedUser() {
    return updatedUser;
  }

  public void setUpdatedUser(String updatedUser) {
    this.updatedUser = updatedUser;
  }
}
