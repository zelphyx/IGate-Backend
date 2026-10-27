import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateAdminDto, UpdateAdminDto } from './dto/admin.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES } from '../common/constants';
import { JwtPayload } from '../common/interfaces/jwt-payload';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(ROLES.SUPERADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  create(@Body() dto: CreateAdminDto) {
    return this.adminService.create(dto);
  }

  @Get()
  findAll() {
    return this.adminService.findAll();
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAdminDto, @Request() req: { user: JwtPayload }) {
    return this.adminService.update(id, dto, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req: { user: JwtPayload }) {
    return this.adminService.remove(id, req.user.sub);
  }
}
