package __BASE_PACKAGE__.domain.entity;

import __BASE_PACKAGE__.mybatis.CommonJsonTypeHandler;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import java.util.Map;

@TableName(value = "t_note", schema = "__DB_NAME__", autoResultMap = true)
public class NoteEntity extends BaseEntity {

  @TableField("c_title")
  private String title;

  @TableField(value = "j_extra", typeHandler = CommonJsonTypeHandler.class)
  private Map<String, Object> extra;

  public String getTitle() {
    return title;
  }

  public void setTitle(String title) {
    this.title = title;
  }

  public Map<String, Object> getExtra() {
    return extra;
  }

  public void setExtra(Map<String, Object> extra) {
    this.extra = extra;
  }
}
