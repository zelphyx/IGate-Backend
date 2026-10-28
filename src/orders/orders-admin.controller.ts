import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { PaginationQuery } from './orders.controller';
import { Roles } from '../common/decorators/roles.decorator';
import { ROLES } from '../common/constants';

@ApiTags('admin-orders')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.SUPERADMIN)
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: PaginationQuery) {
    return this.orders.adminList({
      status: query.status,
      q: query.q,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.orders.adminDetail(id);
  }
}
