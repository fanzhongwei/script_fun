package __BASE_PACKAGE__.mapper;

import __BASE_PACKAGE__.domain.entity.NoteEntity;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface NoteMapper extends BaseMapper<NoteEntity> {}
